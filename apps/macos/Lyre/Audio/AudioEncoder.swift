import AVFoundation
import os

/// Audio encoder that writes either a legacy single mixed track or a
/// real dual-track .m4a using raw `CMSampleBuffer`s — see
/// `docs/06-macos-audio-pipeline-redesign.md` for the full rationale.
///
/// Modes (selected at `setup` time, never switchable mid-recording):
///
/// - `.legacyMixed` (default): a single AAC `AVAssetWriterInput`. The
///   old `encodeSamples(_:)` Float-array entry point still wraps PCM
///   into `CMSampleBuffer`s on this input, so existing
///   `RecordingManager` / `AudioMixer` callers keep working until task
///   #5 / #6 retire them. Sidecar is NOT written in legacy mode — there
///   is no per-source attribution to record.
///
/// - `.dualTrack`: two AAC `AVAssetWriterInput`s, `add(system)` then
///   `add(mic)` (the order locked in by Phase 0A's
///   `AVAssetWriterTrackOrderProbeTests`). Real `CMSampleBuffer`s come
///   in via `enqueue(_:source:)` and are appended directly.
///
///     - **Mitigation A (silent prefix on late first frame) — NOT
///       implemented on this path.** Phase 1A established that
///       AAC `AVAssetWriterInput` trims the leading section of the
///       late-arriving track regardless of any zero / padded /
///       dithered PCM prefix, so the prefix approach cannot rescue
///       the missing leading silence. The late-first-frame behaviour
///       is pinned by `lateSourceFirstFrameRemainsTrimmedByAVAssetWriter`
///       in `AudioEncoderTests.swift` and documented in
///       `docs/06-macos-audio-pipeline-redesign.md`. Any future fix
///       belongs in capture-layer warmup or an offline composition
///       path evaluated in task #5 / #6.
///
///     - **Mitigation B — silent gap fill**: Phase 0A proved
///       same-track PTS gaps are compressed into back-to-back audio.
///       Per-track `lastAppendedEndPTS` is tracked; any incoming buffer
///       whose start PTS is more than 10 ms after that point gets a
///       silent PCM filler appended first.
///
/// Threading: a dedicated serial `DispatchQueue` guards every mutation.
/// External entry points (`setup`, `enqueue`, `encodeSamples`,
/// `finalize`) are safe to call from any thread.
final class AudioEncoder: @unchecked Sendable {
    static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "AudioEncoder",
    )

    enum EncoderMode: Equatable {
        case legacyMixed
        case dualTrack
    }

    enum Source: String, Equatable, Sendable {
        case system
        case mic
    }

    enum EncoderError: LocalizedError, Equatable {
        case setupFailed(String)
        case writerFailed(String)
        case wrongMode(String)

        var errorDescription: String? {
            switch self {
            case .setupFailed(let detail):
                return "Encoder setup failed: \(detail)"
            case .writerFailed(let detail):
                return "Encoder write failed: \(detail)"
            case .wrongMode(let detail):
                return "Encoder wrong-mode call: \(detail)"
            }
        }
    }

    /// First-frame-to-second-frame deadline. After the first source
    /// frame lands the encoder waits this long for the second source
    /// before starting the session single-source.
    static let firstFrameTimeoutMs: Double = 500

    /// Mitigation B fill threshold. Gaps larger than this between
    /// consecutive real buffers on the same track get a silent PCM
    /// filler appended first.
    static let gapFillThresholdMs: Double = 10

    /// Whether the encoder is actively writing.
    var isWriting: Bool {
        queue.sync { assetWriter?.status == .writing }
    }

    /// Last error captured by `finalize()`. Cleared by `setup()` so a
    /// re-used encoder instance does not surface a stale value.
    /// Provides callers (RecordingManager, future task #5) a way to
    /// observe writer/flush failures without changing the non-throwing
    /// `finalize()` signature that legacy `RecordingManager.stopRecording`
    /// still depends on.
    var lastError: Error? {
        queue.sync { lastErrorInternal }
    }
    var lastErrorInternal: Error?

    // MARK: - Private state (guarded by `queue`)

    let queue = DispatchQueue(label: "ai.hexly.lyre.AudioEncoder")

    var mode: EncoderMode = .legacyMixed
    var outputURL: URL?
    var assetWriter: AVAssetWriter?

    // Legacy single-input state. `internal` (module-only) instead of
    // `private` so the legacy sample-buffer creator can live in
    // `AudioEncoderHelpers.swift` and keep this file under the
    // SwiftLint type-body / file-length thresholds.
    var legacyInput: AVAssetWriterInput?
    var legacyFormat: AVAudioFormat?
    var legacyTotalSamplesWritten: Int64 = 0

    // Dual-track inputs (keyed by Source). `internal` for the same
    // reason as the legacy fields above.
    var systemInput: AVAssetWriterInput?
    var micInput: AVAssetWriterInput?

    // Dual-track state machine
    enum SessionState {
        case awaitingAnyFrame
        case awaitingSecondOrTimeout(firstSource: Source)
        case sessionStarted(sessionPTS: CMTime)
    }
    var sessionState: SessionState = .awaitingAnyFrame
    var systemFifo: [CMSampleBuffer] = []
    var micFifo: [CMSampleBuffer] = []
    var timeoutWorkItem: DispatchWorkItem?

    // Per-source attribution flags. `internal` for the bookkeeping
    // accessors that live in `AudioEncoderHelpers.swift`.
    var systemAppendedAny = false
    var micAppendedAny = false
    var systemAppendedReal = false
    var micAppendedReal = false

    // Per-source PTS bookkeeping.
    var systemLastEndPTS: CMTime?
    var micLastEndPTS: CMTime?
    var systemLastStartPTS: CMTime?
    var micLastStartPTS: CMTime?

    let sampleRate: Double
    private let channelCount: UInt32
    private let bitRate: Int

    // MARK: - Init

    init(
        sampleRate: Double = Constants.Audio.sampleRate,
        channelCount: UInt32 = Constants.Audio.channelCount,
        bitRate: Int = Constants.Audio.aacBitRate
    ) {
        self.sampleRate = sampleRate
        self.channelCount = channelCount
        self.bitRate = bitRate
    }

    // MARK: - Lifecycle

    /// Set up the writer in the default `.legacyMixed` mode.
    ///
    /// Equivalent to `setup(outputURL:, mode: .legacyMixed)`. Kept as a
    /// distinct entry point so existing `RecordingManager` callers do
    /// not have to thread a mode argument until task #5 wires the dual
    /// path.
    func setup(outputURL: URL) throws {
        try setup(outputURL: outputURL, mode: .legacyMixed)
    }

    /// Set up the writer in the requested mode.
    func setup(outputURL: URL, mode: EncoderMode) throws {
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        } catch {
            throw EncoderError.setupFailed(error.localizedDescription)
        }

        // Move the moov atom to the head of the file (faststart). Without
        // this, AVAssetWriter writes moov at the tail, and Chromium's
        // <audio preload="metadata"> can't decode the sample tables on a
        // single Range request — the file plays fine locally but arrives
        // silently in the browser even though loadedmetadata fires.
        writer.shouldOptimizeForNetworkUse = true

        switch mode {
        case .legacyMixed:
            try setupLegacy(writer: writer)
        case .dualTrack:
            try setupDual(writer: writer)
        }

        queue.sync {
            self.mode = mode
            self.outputURL = outputURL
            self.assetWriter = writer
            self.lastErrorInternal = nil
        }
    }

    private func setupLegacy(writer: AVAssetWriter) throws {
        let input = makeAACInput()
        guard writer.canAdd(input) else {
            throw EncoderError.setupFailed("AVAssetWriter cannot add legacy audio input")
        }
        writer.add(input)
        guard writer.startWriting() else {
            let detail = writer.error?.localizedDescription ?? "unknown error"
            throw EncoderError.setupFailed(detail)
        }
        writer.startSession(atSourceTime: .zero)

        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: channelCount,
            interleaved: false
        )
        queue.sync {
            self.legacyTotalSamplesWritten = 0
            self.legacyInput = input
            self.legacyFormat = format
        }
    }

    private func setupDual(writer: AVAssetWriter) throws {
        let sys = makeAACInput()
        let mic = makeAACInput()
        guard writer.canAdd(sys), writer.canAdd(mic) else {
            throw EncoderError.setupFailed("AVAssetWriter cannot add dual audio inputs")
        }
        // add() order is the only role anchor — Phase 0A track-order
        // probe confirmed tracks[0] == first add() target.
        writer.add(sys)
        writer.add(mic)
        guard writer.startWriting() else {
            let detail = writer.error?.localizedDescription ?? "unknown error"
            throw EncoderError.setupFailed(detail)
        }
        // The session timer is NOT armed at setup. SCK cold-start can
        // exceed 500 ms; we arm only when the first real frame lands.
        queue.sync {
            self.systemInput = sys
            self.micInput = mic
            self.sessionState = .awaitingAnyFrame
            self.systemFifo.removeAll()
            self.micFifo.removeAll()
            self.systemAppendedAny = false
            self.micAppendedAny = false
            self.systemAppendedReal = false
            self.micAppendedReal = false
            self.systemLastEndPTS = nil
            self.micLastEndPTS = nil
            self.systemLastStartPTS = nil
            self.micLastStartPTS = nil
        }
    }

    private func makeAACInput() -> AVAssetWriterInput {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channelCount,
            AVEncoderBitRateKey: bitRate,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        // expectsMediaDataInRealTime tells the writer the buffers come
        // from a live source (SCK) so it should not block the producer
        // by holding `isReadyForMoreMediaData` low. In tests we still
        // synthesise buffers but the realtime hint does not affect
        // correctness — just throughput tuning.
        input.expectsMediaDataInRealTime = true
        return input
    }

    // MARK: - Dual-track ingest

    /// Enqueue a real PCM `CMSampleBuffer` from one of the two sources.
    /// Only valid when the encoder was set up with mode `.dualTrack`.
    @discardableResult
    func enqueue(_ buffer: CMSampleBuffer, source: Source) throws -> Bool {
        try queue.sync {
            try enqueueLocked(buffer, source: source)
        }
    }

    private func enqueueLocked(_ buffer: CMSampleBuffer, source: Source) throws -> Bool {
        guard mode == .dualTrack else {
            throw EncoderError.wrongMode("enqueue(_:source:) requires .dualTrack setup")
        }
        guard let writer = assetWriter, writer.status == .writing else {
            return false
        }
        guard let input = inputFor(source: source) else { return false }

        switch sessionState {
        case .awaitingAnyFrame:
            // First-ever buffer. Cache it, arm the first-frame timeout
            // for the other source.
            appendToFifo(buffer, source: source)
            scheduleFirstFrameTimeoutLocked(firstSource: source)
            return true

        case .awaitingSecondOrTimeout(let first):
            appendToFifo(buffer, source: source)
            if source != first {
                cancelFirstFrameTimeoutLocked()
                try beginSessionLocked()
            }
            return true

        case .sessionStarted:
            return try writeRealBufferLocked(buffer, source: source, input: input)
        }
    }

    // MARK: - Legacy ingest

    /// Encode Float32 PCM samples through the legacy single-track path.
    /// Kept for backwards compatibility with `AudioMixer` until task
    /// #5 / #6 retire it.
    @discardableResult
    func encodeSamples(_ samples: [Float]) -> Bool {
        queue.sync {
            encodeSamplesLocked(samples)
        }
    }

    private func encodeSamplesLocked(_ samples: [Float]) -> Bool {
        guard mode == .legacyMixed else {
            Self.logger.error("encodeSamples called on .dualTrack encoder — dropping samples")
            return false
        }
        guard let input = legacyInput,
              let writer = assetWriter,
              writer.status == .writing else { return false }
        guard input.isReadyForMoreMediaData else {
            Self.logger.warning("Legacy input not ready, dropping \(samples.count) samples")
            return false
        }
        guard let sampleBuffer = createLegacySampleBufferLocked(from: samples) else {
            Self.logger.warning("Failed to create legacy sample buffer from \(samples.count) samples")
            return false
        }
        let appended = input.append(sampleBuffer)
        if !appended {
            let detail = writer.error?.localizedDescription ?? "unknown"
            Self.logger.error("Legacy append() failed: \(detail)")
        }
        return appended
    }

    // MARK: - Finalize / Session management / Real-buffer append
    //
    // Implementations live in `AudioEncoderHelpers.swift`.
    //
    // - `finalize()` (public): drives writer.finishWriting, captures
    //   `lastError`, writes sidecar, resets state.
    // - `FinalizeSnapshot`: data carrier passed to the sidecar writer.
    // - `resetStateLocked(preserveLastError:)`: clears session/buffer
    //   state under the queue.
    // - `appendToFifo`, `scheduleFirstFrameTimeoutLocked`,
    //   `cancelFirstFrameTimeoutLocked`, `beginSessionLocked`: dual
    //   session-state machine.
    // - `writeRealBufferLocked`, `computeEndPTS`, `framesBetween`:
    //   real-buffer append + Mitigation B silent gap fill.

    struct FinalizeSnapshot {
        let mode: EncoderMode
        let writer: AVAssetWriter?
        let outputURL: URL?
        let sessionStateIsAwaitingAnyFrame: Bool
        let systemAppendedReal: Bool
        let micAppendedReal: Bool
    }

    // MARK: - Per-source bookkeeping accessors / Legacy sample buffer
    //
    // Implementations live in `AudioEncoderHelpers.swift`.

    // MARK: - Sidecar / silent PCM helpers
    //
    // Implementations live in `AudioEncoderHelpers.swift`.
}
