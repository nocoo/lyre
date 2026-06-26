import AVFoundation
import os

/// Manages the full recording lifecycle: permissions → capture → encode → M4A file.
///
/// State machine:
/// - `.idle` → ready to record
/// - `.recording` → actively capturing and encoding audio
///
/// Uses `AudioCaptureManager` for SCK capture and `AudioEncoder` for M4A/AAC encoding.
@Observable
final class RecordingManager: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "RecordingManager")

    enum State: Equatable, Sendable {
        case idle
        case recording
    }

    enum RecordingError: LocalizedError, Equatable {
        case alreadyRecording
        case notRecording
        case permissionDenied
        case encoderSetupFailed(String)

        var errorDescription: String? {
            switch self {
            case .alreadyRecording:
                return "A recording is already in progress"
            case .notRecording:
                return "No recording is in progress"
            case .permissionDenied:
                return "Required permissions have not been granted"
            case .encoderSetupFailed(let detail):
                return "Failed to set up audio encoder: \(detail)"
            }
        }
    }

    // MARK: - Observable state

    internal(set) var state: State = .idle
    internal(set) var currentFileURL: URL?
    internal(set) var recordingStartTime: Date?

    /// Elapsed seconds since recording started. Updated externally by a timer or UI poll.
    var elapsedSeconds: TimeInterval {
        guard let start = recordingStartTime else { return 0 }
        return Date().timeIntervalSince(start)
    }

    /// Last error that occurred during recording.
    internal(set) var lastError: Error?

    // MARK: - Dependencies

    let permissions: RecordingPermissions
    let capture: AudioCapturing

    /// Concrete `PermissionManager` for the SwiftUI menus that need
    /// the @Observable surface. `nil` when a test injected a non-
    /// production permissions impl.
    var permissionsObservable: PermissionManager? { permissions as? PermissionManager }

    /// Concrete `AudioCaptureManager` for the SwiftUI menus that bind
    /// device pickers through the @Observable surface. `nil` when a
    /// test injected a non-production capture impl.
    var captureObservable: AudioCaptureManager? { capture as? AudioCaptureManager }

    /// Directory where recordings are saved.
    var outputDirectory: URL

    /// Recorder mode for new recordings.
    let useDualTrack: Bool

    // MARK: - Private encoder

    private let encoderFactory: () -> AudioEncoding
    private var encoder: AudioEncoding?

    // MARK: - Init

    init(
        permissions: RecordingPermissions = PermissionManager(),
        capture: AudioCapturing = AudioCaptureManager(),
        encoderFactory: @escaping () -> AudioEncoding = { AudioEncoder() },
        useDualTrack: Bool = true,
        outputDirectory: URL? = nil
    ) {
        self.permissions = permissions
        self.capture = capture
        self.encoderFactory = encoderFactory
        self.useDualTrack = useDualTrack
        self.outputDirectory = outputDirectory ?? Self.defaultOutputDirectory()
    }

    // MARK: - Recording Control

    /// Start recording system audio + microphone to an M4A file.
    ///
    /// - Throws: `RecordingError` if already recording, permissions missing, or encoder fails.
    func startRecording() async throws {
        guard state == .idle else {
            throw RecordingError.alreadyRecording
        }

        // Verify permissions
        await permissions.checkAll()
        guard permissions.allGranted else {
            throw RecordingError.permissionDenied
        }

        lastError = nil

        // Prepare output file
        try ensureOutputDirectory()
        let fileURL = generateOutputURL()

        // Set up encoder in the requested mode. Note: setup() is called
        // with an explicit EncoderMode either way so the recording path
        // is observable from tests via the encoder's internal mode.
        let enc = encoderFactory()
        let mode: AudioEncoder.EncoderMode = useDualTrack ? .dualTrack : .legacyMixed
        do {
            try enc.setup(outputURL: fileURL, mode: mode)
        } catch let error as AudioEncoder.EncoderError {
            throw RecordingError.encoderSetupFailed(error.localizedDescription)
        }
        encoder = enc

        // Wire up capture → encoder pipeline. The two paths are
        // mutually exclusive: dual installs raw callbacks only, legacy
        // installs only onMixedSamples. AudioCaptureManager uses the
        // mixed-callback presence to decide whether to arm the drain
        // timer, so a stray onMixedSamples on the dual path would
        // silently pay the mixer cost.
        if useDualTrack {
            wireDualCallbacks()
        } else {
            wireLegacyCallbacks()
        }
        capture.onStreamError = { [weak self] error in
            self?.handleStreamError(error)
        }

        // Start capture
        try await capture.startCapture()

        currentFileURL = fileURL
        recordingStartTime = Date()
        state = .recording
    }

    private func wireDualCallbacks() {
        capture.onRawSystemBuffer = { [weak self] buf in
            self?.enqueueDualBuffer(buf, source: .system)
        }
        capture.onRawMicBuffer = { [weak self] buf in
            self?.enqueueDualBuffer(buf, source: .mic)
        }
        capture.onMixedSamples = nil
    }

    private func wireLegacyCallbacks() {
        capture.onMixedSamples = { [weak self] samples in
            _ = self?.encoder?.encodeSamples(samples)
        }
        capture.onRawSystemBuffer = nil
        capture.onRawMicBuffer = nil
    }

    /// Append a raw `CMSampleBuffer` to the dual-track encoder. Errors
    /// — both `throw`s and a `false` return — are surfaced via
    /// `lastError`; we do not stop the stream because finalize() will
    /// also capture writer/flush failures and surface them at the same
    /// place, so a brief enqueue blip does not necessarily mean the
    /// whole recording is lost.
    private func enqueueDualBuffer(_ buffer: CMSampleBuffer, source: AudioEncoder.Source) {
        guard let enc = encoder else { return }
        do {
            let ok = try enc.enqueue(buffer, source: source)
            if !ok {
                lastError = AudioEncoder.EncoderError.writerFailed(
                    "enqueue returned false for \(source.rawValue)"
                )
                Self.logger.error("Dual enqueue (\(source.rawValue)) returned false")
            }
        } catch {
            lastError = error
            Self.logger.error("Dual enqueue (\(source.rawValue)) threw: \(error.localizedDescription)")
        }
    }

    /// Stop the current recording and finalize the M4A file.
    ///
    /// Cleanup is wrapped in `defer` so state machine, encoder
    /// reference, and capture callbacks all reset even when
    /// `stopCapture()` or `finalize()` throws partway through. Without
    /// this, a `stopCapture()` failure would leave `state == .recording`
    /// + a dangling encoder + live capture callbacks, and the next
    /// `startRecording()` would either hit the `.alreadyRecording`
    /// guard or push buffers into a finalized encoder.
    ///
    /// - Returns: URL of the completed M4A file.
    /// - Throws: `RecordingError.notRecording` if not currently
    ///   recording. Re-throws the underlying `EncoderError.writerFailed`
    ///   when `finalize()` reports a writer / flush failure so the
    ///   caller can surface the failure to the user instead of treating
    ///   a partial file as success.
    @discardableResult
    func stopRecording() async throws -> URL {
        guard state == .recording, let fileURL = currentFileURL else {
            throw RecordingError.notRecording
        }

        let enc = encoder
        defer {
            // Snapshot encoder.lastError before nil-ing the reference so
            // a finalize-time failure (writer flush / status != .completed)
            // still reaches our own `lastError` surface even when the
            // caller does not catch the rethrown error.
            if let err = enc?.lastError {
                lastError = err
                Self.logger.error("Encoder lastError on finalize: \(err.localizedDescription)")
            }
            encoder = nil
            cleanupCaptureCallbacks()
            state = .idle
            recordingStartTime = nil
        }

        try await capture.stopCapture()
        try await enc?.finalize()

        return fileURL
    }

    /// Centralised callback teardown so both the normal stop path and
    /// the stream-error recovery path always clear the full set of
    /// raw + legacy callbacks. Dropping any of these would leak a
    /// closure capturing `self` past the recording's lifetime.
    private func cleanupCaptureCallbacks() {
        capture.onRawSystemBuffer = nil
        capture.onRawMicBuffer = nil
        capture.onMixedSamples = nil
        capture.onStreamError = nil
    }

    // MARK: - Error Handling

    private func handleStreamError(_ error: Error) {
        lastError = error
        Self.logger.error("Stream error: \(error.localizedDescription)")

        // Best-effort recovery: always finalize encoder even if capture
        // stop fails, to avoid corrupting the output file.
        Task {
            // Try to stop capture, but don't let failure prevent finalization
            do {
                try await capture.stopCapture()
            } catch {
                Self.logger.warning(
                    "stopCapture failed during error recovery: \(error.localizedDescription)"
                )
            }

            // Always finalize encoder to close the output file properly.
            // Same lastError-before-nil pattern as stopRecording().
            // `finalize()` is `throws` now; swallow here because the
            // stream-error recovery path is best-effort — we want to
            // close the file no matter what — but still surface the
            // failure through `lastError` for the UI.
            let enc = encoder
            do {
                try await enc?.finalize()
            } catch {
                lastError = error
                Self.logger.error(
                    "Encoder finalize threw during stream-error recovery: \(error.localizedDescription)"
                )
            }
            if let err = enc?.lastError {
                lastError = err
                Self.logger.error("Encoder lastError on stream-error finalize: \(err.localizedDescription)")
            }
            encoder = nil

            cleanupCaptureCallbacks()
            state = .idle
            recordingStartTime = nil

            Self.logger.info("Recording stopped after stream error, file may be partial")
        }
    }

    // MARK: - File Management

    /// Default output directory: ~/Documents/Lyre Recordings/
    static func defaultOutputDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lyre Recordings", isDirectory: true)
    }

    /// Ensure the output directory exists.
    private func ensureOutputDirectory() throws {
        try FileManager.default.createDirectory(
            at: outputDirectory,
            withIntermediateDirectories: true
        )
    }

    /// Generate a timestamped output file URL.
    ///
    /// Format: `Recording 2026-02-26 at 10.30.45.m4a`
    func generateOutputURL() -> URL {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let timestamp = formatter.string(from: Date())
        let filename = "Recording \(timestamp).m4a"
        return outputDirectory.appendingPathComponent(filename)
    }
}
