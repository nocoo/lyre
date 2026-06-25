import AVFoundation
import Testing
@testable import Lyre

/// Phase 0C tests for `AudioPlayerManager` after the switch from
/// `AVAudioPlayer` to `AVPlayer`. These cover the externally-observable
/// state machine; actual audio rendering can only be verified on a real
/// desktop (see task #7 6DQ).
@Suite("AudioPlayerManager state machine")
struct AudioPlayerManagerTests {
    @Test func initialStateIsStopped() {
        let mgr = AudioPlayerManager()
        #expect(mgr.state == .stopped)
        #expect(mgr.currentTime == 0)
        #expect(mgr.duration == 0)
        #expect(mgr.isActive(URL(fileURLWithPath: "/tmp/x.m4a")) == false)
        #expect(mgr.isPlaying(URL(fileURLWithPath: "/tmp/x.m4a")) == false)
    }

    @Test func playTransitionsToPlayingState() async throws {
        let url = try Self.writeSilentFixture()
        defer { try? FileManager.default.removeItem(at: url) }

        let mgr = AudioPlayerManager()
        await MainActor.run { mgr.play(url) }
        #expect(mgr.state == .playing(url))
        #expect(mgr.isPlaying(url))
        #expect(mgr.isActive(url))

        await MainActor.run { mgr.stop() }
    }

    @Test func pauseTransitionsToPausedSameUrl() async throws {
        let url = try Self.writeSilentFixture()
        defer { try? FileManager.default.removeItem(at: url) }

        let mgr = AudioPlayerManager()
        await MainActor.run { mgr.play(url) }
        await MainActor.run { mgr.pause() }
        #expect(mgr.state == .paused(url))
        // After pause we are still "active" (we still own this url) but
        // not actively "playing" — UI uses these two flags to swap the
        // pause/resume icon.
        #expect(mgr.isActive(url))
        #expect(mgr.isPlaying(url) == false)

        await MainActor.run { mgr.stop() }
    }

    @Test func toggleResumesFromPaused() async throws {
        let url = try Self.writeSilentFixture()
        defer { try? FileManager.default.removeItem(at: url) }

        let mgr = AudioPlayerManager()
        await MainActor.run { mgr.play(url) }
        await MainActor.run { mgr.pause() }
        #expect(mgr.state == .paused(url))

        await MainActor.run { mgr.toggle(url) }
        // Resuming must NOT regress to .stopped — the new AVPlayer
        // implementation keeps the existing player item rather than
        // tearing it down on the resume path.
        #expect(mgr.state == .playing(url))

        await MainActor.run { mgr.stop() }
    }

    @Test func stopResetsAllFields() async throws {
        let url = try Self.writeSilentFixture()
        defer { try? FileManager.default.removeItem(at: url) }

        let mgr = AudioPlayerManager()
        await MainActor.run { mgr.play(url) }
        await MainActor.run { mgr.stop() }
        #expect(mgr.state == .stopped)
        #expect(mgr.currentTime == 0)
        #expect(mgr.duration == 0)
        #expect(mgr.isActive(url) == false)
    }

    @Test func playingDifferentUrlSwitchesActiveUrl() async throws {
        let a = try Self.writeSilentFixture(name: "a.m4a")
        let b = try Self.writeSilentFixture(name: "b.m4a")
        defer {
            try? FileManager.default.removeItem(at: a)
            try? FileManager.default.removeItem(at: b)
        }

        let mgr = AudioPlayerManager()
        await MainActor.run { mgr.play(a) }
        #expect(mgr.isActive(a))
        await MainActor.run { mgr.play(b) }
        #expect(mgr.state == .playing(b))
        #expect(mgr.isActive(a) == false)
        #expect(mgr.isActive(b))

        await MainActor.run { mgr.stop() }
    }

    @Test func stopBeforeDurationLoadKeepsDurationZero() async throws {
        // Race-condition pin: `AVURLAsset.load(.duration)` is async, so
        // an early `stop()` after `play()` must not let the older load
        // callback stomp the now-zero duration. The generation token in
        // AudioPlayerManager guards this; if the guard regresses this
        // test fails.
        let url = try Self.writeSilentFixture()
        defer { try? FileManager.default.removeItem(at: url) }

        let mgr = AudioPlayerManager()
        await MainActor.run {
            mgr.play(url)
            mgr.stop()
        }
        // Wait long enough for any pending duration load to land. 500 ms
        // is multiple decode loops worth of slack on M-class machines.
        try? await Task.sleep(nanoseconds: 500_000_000)
        #expect(mgr.duration == 0, "duration after stop should stay 0; observed \(mgr.duration)")
        #expect(mgr.state == .stopped)
    }

    // MARK: - Fixtures

    private static func writeSilentFixture(name: String = "silent.m4a") throws -> URL {
        // 0.5 s of silent PCM written to disk so AVPlayer has a real
        // file to attach to. AVAssetWriter would be more rigorous but
        // these tests only need the state machine to behave; the audio
        // stream itself is not measured here.
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("apt-\(UUID().uuidString)-\(name)")
        let (writer, input) = try makeWriter(at: url)
        let sampleBuffer = try makeSilentSampleBuffer()
        #expect(input.append(sampleBuffer))
        input.markAsFinished()

        let group = DispatchGroup()
        group.enter()
        writer.finishWriting { group.leave() }
        group.wait()
        #expect(writer.status == .completed)

        return url
    }

    private static func makeWriter(at url: URL) throws -> (AVAssetWriter, AVAssetWriterInput) {
        let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        writer.add(input)
        #expect(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        return (writer, input)
    }

    private static func makeSilentSampleBuffer() throws -> CMSampleBuffer {
        let sampleRate: Double = 48_000
        let frameCount = AVAudioFrameCount(0.5 * sampleRate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            throw FixtureError.format
        }
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            throw FixtureError.pcm
        }
        pcm.frameLength = frameCount  // all zero by default

        var formatDescription: CMAudioFormatDescription?
        let fmtStatus = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: format.streamDescription,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &formatDescription,
        )
        #expect(fmtStatus == noErr)

        var sampleBuffer: CMSampleBuffer?
        let createStatus = CMAudioSampleBufferCreateWithPacketDescriptions(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: formatDescription!,
            sampleCount: Int(frameCount),
            presentationTimeStamp: .zero,
            packetDescriptions: nil,
            sampleBufferOut: &sampleBuffer,
        )
        #expect(createStatus == noErr)
        let setStatus = CMSampleBufferSetDataBufferFromAudioBufferList(
            sampleBuffer!,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: pcm.audioBufferList,
        )
        #expect(setStatus == noErr)
        return sampleBuffer!
    }

    enum FixtureError: Error { case format, pcm }
}
