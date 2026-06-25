import AVFoundation
import Testing
@testable import Lyre

/// Phase 0A probes that lock in the **current** AVAssetWriter platform
/// behaviour that `docs/06-macos-audio-pipeline-redesign.md` relies on.
///
/// These are not "assumption holds" tests — they are **platform behaviour
/// proofs**. They pin down two facts that the production AudioEncoder
/// rewrite (task #4) must respond to with Mitigation A and Mitigation B:
///
/// - **Mitigation A evidence — delayed first frame is normalised to track
///   time 0.** With `startSession(atSourceTime: .zero)` followed by a
///   first PCM sample at PTS 0.5 s, AVAssetWriter drops the 0.5 s of head
///   silence rather than preserving it. Production code MUST therefore
///   prepend an explicit silent PCM buffer when one input's first real
///   PTS is later than the global session start.
/// - **Mitigation B evidence — same-track PTS gaps are compressed.**
///   Appending two PCM segments with a 600 ms gap and no silent fill in
///   between produces a track whose total duration is ~1.4 s (the two
///   segments concatenated), not the ~2.0 s of original timeline.
///   Production code MUST therefore fill detected gaps with synthesized
///   silent PCM before append.
///
/// These tests passing is the **stable** state. If a future macOS /
/// AVFoundation update changes either behaviour the test will fail and
/// signal that Mitigation A or Mitigation B can be re-evaluated.
@Suite("Phase 0A: AVAssetWriter PTS platform behaviour proofs")
struct AVAssetWriterPTSProbeTests {
    private static let sampleRate: Double = 48_000
    private static let channelCount: AVAudioChannelCount = 1
    private static let timescale: CMTimeScale = CMTimeScale(sampleRate)

    @Test func delayedFirstFrameIsNormalisedToZero() throws {
        let outputURL = Self.makeTemporaryURL()
        defer { try? FileManager.default.removeItem(at: outputURL) }

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        let input = try Self.makeAACInput()
        // expectsMediaDataInRealTime must be set BEFORE addInput / startWriting.
        input.expectsMediaDataInRealTime = false
        writer.add(input)

        #expect(writer.startWriting())
        // Session origin sits at t = 0 so the writer has a baseline to
        // measure the gap from.
        writer.startSession(atSourceTime: .zero)

        // First buffer's PTS starts at 0.5 s — 1 s of audio total.
        let firstPTS = CMTime(value: CMTimeValue(0.5 * Double(Self.timescale)), timescale: Self.timescale)
        let pcm = Self.makeSineBuffer(
            frequency: 440,
            durationSeconds: 1.0,
            startPTS: firstPTS,
        )
        #expect(input.append(pcm))
        input.markAsFinished()

        let group = DispatchGroup()
        group.enter()
        writer.finishWriting { group.leave() }
        group.wait()
        #expect(writer.status == .completed, "writer failed: \(String(describing: writer.error))")

        let firstSamplePTS = try Self.readFirstSamplePTS(from: outputURL)
        let observed = firstSamplePTS.seconds
        // Platform behaviour: the writer normalises the delayed first
        // frame to track time 0. Tolerance of 50 ms absorbs sub-sample
        // jitter from AAC framing.
        #expect(abs(observed) <= 0.05, "Expected ~0s first sample PTS (head silence stripped); observed=\(observed)s")
    }

    @Test func ptsGapIsCompressed() throws {
        let outputURL = Self.makeTemporaryURL()
        defer { try? FileManager.default.removeItem(at: outputURL) }

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        let input = try Self.makeAACInput()
        // expectsMediaDataInRealTime must be set BEFORE addInput / startWriting.
        input.expectsMediaDataInRealTime = false
        writer.add(input)

        #expect(writer.startWriting())
        writer.startSession(atSourceTime: .zero)

        // Segment 1: 0 .. 0.5 s.
        let seg1 = Self.makeSineBuffer(
            frequency: 440,
            durationSeconds: 0.5,
            startPTS: .zero,
        )
        #expect(input.append(seg1))

        // Segment 2: 1.1 .. 2.0 s (600 ms PTS gap, no silent fill).
        let seg2Start = CMTime(value: CMTimeValue(1.1 * Double(Self.timescale)), timescale: Self.timescale)
        let seg2 = Self.makeSineBuffer(
            frequency: 440,
            durationSeconds: 0.9,
            startPTS: seg2Start,
        )
        #expect(input.append(seg2))

        input.markAsFinished()
        let group = DispatchGroup()
        group.enter()
        writer.finishWriting { group.leave() }
        group.wait()
        #expect(writer.status == .completed, "writer failed: \(String(describing: writer.error))")

        // Platform behaviour: the 600 ms PTS gap is compressed away, so
        // the track ends near 1.4 s (0.5 + 0.9 of actual audio glued
        // together) rather than the 2.0 s of original timeline.
        let trackDuration = try Self.readTrackDurationSeconds(from: outputURL)
        // swiftlint:disable:next line_length
        #expect(trackDuration >= 1.30 && trackDuration <= 1.55, "Expected gap-compressed duration in [1.30, 1.55]s; observed=\(trackDuration)s")
    }

    // MARK: - Helpers

    private static func makeTemporaryURL() -> URL {
        let dir = FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("pts-probe-\(UUID().uuidString).m4a")
    }

    private static func makeAACInput() throws -> AVAssetWriterInput {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: Int(channelCount),
            AVEncoderBitRateKey: 128_000,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        return input
    }

    /// Build a single PCM `CMSampleBuffer` containing a sine wave with the
    /// given start PTS. Format: 48 kHz / 1 ch / Float32 PCM — produced via
    /// `AVAudioPCMBuffer` so the format description and sample timing line
    /// up with what `AVAssetWriterInput`'s AAC encoder expects.
    static func makeSineBuffer(
        frequency: Double,
        durationSeconds: Double,
        startPTS: CMTime,
    ) -> CMSampleBuffer {
        let frameCount = AVAudioFrameCount(durationSeconds * sampleRate)
        guard let format = AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: 1,
        ) else {
            preconditionFailure("AVAudioFormat init failed")
        }
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            preconditionFailure("AVAudioPCMBuffer init failed")
        }
        pcm.frameLength = frameCount

        let amplitude: Float = 0.4
        let channelData = pcm.floatChannelData![0]
        for i in 0..<Int(frameCount) {
            let t = Double(i) / sampleRate
            channelData[i] = amplitude * Float(sin(2 * .pi * frequency * t))
        }

        // Wrap the PCM buffer into a CMSampleBuffer at the requested PTS.
        // `AVAudioPCMBuffer` exposes its underlying `AudioBufferList`; we
        // create a fresh format description matching the standard format
        // and feed the float samples into a CMBlockBuffer.
        let asbdPtr = format.streamDescription
        var formatDescription: CMAudioFormatDescription?
        let fmtStatus = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: asbdPtr,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &formatDescription,
        )
        precondition(fmtStatus == noErr, "format desc status=\(fmtStatus)")

        var sampleBuffer: CMSampleBuffer?
        let createStatus = CMAudioSampleBufferCreateWithPacketDescriptions(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: formatDescription!,
            sampleCount: Int(frameCount),
            presentationTimeStamp: startPTS,
            packetDescriptions: nil,
            sampleBufferOut: &sampleBuffer,
        )
        precondition(createStatus == noErr && sampleBuffer != nil, "sample buffer status=\(createStatus)")

        let setStatus = CMSampleBufferSetDataBufferFromAudioBufferList(
            sampleBuffer!,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: pcm.audioBufferList,
        )
        precondition(setStatus == noErr, "set abl status=\(setStatus)")

        return sampleBuffer!
    }

    static func readFirstSamplePTS(from url: URL) throws -> CMTime {
        let asset = AVURLAsset(url: url)
        let track = try awaitable { () throws -> SendableTrackHandle in
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            guard let track = tracks.first else { throw ProbeError.noTrack }
            return SendableTrackHandle(track: track)
        }

        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(
            track: track.unwrap,
            outputSettings: nil,
        )
        reader.add(output)
        reader.startReading()
        guard let sample = output.copyNextSampleBuffer() else {
            throw ProbeError.noSample
        }
        return CMSampleBufferGetPresentationTimeStamp(sample)
    }

    static func readTrackDurationSeconds(from url: URL) throws -> Double {
        let asset = AVURLAsset(url: url)
        return try awaitable { () throws -> Double in
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            guard let track = tracks.first else { throw ProbeError.noTrack }
            let timeRange = try await track.load(.timeRange)
            return CMTimeGetSeconds(timeRange.duration)
        }
    }

    enum ProbeError: Error { case noTrack, noSample }

    /// Carry a non-Sendable `AVAssetTrack` across the `Task` boundary by
    /// declaring its container `@unchecked Sendable` — safe here because
    /// the track is read-only and is consumed on the calling thread only
    /// after the `awaitable` task has fully completed.
    struct SendableTrackHandle: @unchecked Sendable {
        let track: AVAssetTrack
        var unwrap: AVAssetTrack { track }
    }

    /// Bridge async `AVAsset` loaders into the synchronous test runner.
    /// Uses a semaphore wait that survives Swift 6 strict concurrency
    /// checking — the closure must produce a `Sendable` value so it can
    /// cross the Task boundary.
    static func awaitable<T: Sendable>(_ body: @escaping @Sendable () async throws -> T) throws -> T {
        let semaphore = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var captured: Result<T, Error>!
        Task {
            do {
                let value = try await body()
                captured = .success(value)
            } catch {
                captured = .failure(error)
            }
            semaphore.signal()
        }
        semaphore.wait()
        return try captured.get()
    }
}
