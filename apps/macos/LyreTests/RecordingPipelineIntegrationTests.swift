import Testing
import Foundation
import AVFoundation
import CoreMedia
@testable import Lyre

/// Integration tests for the full RecordingManager → AudioEncoder
/// pipeline using a fake capture seam so the test does not depend on
/// ScreenCaptureKit / system permissions / live audio sources. Real
/// `AudioEncoder` instances write a real .m4a + sidecar, and we
/// assert the docs/06 dual-track acceptance: two audio tracks, a
/// well-formed sidecar mapping, and add() order preserved.
@Suite("RecordingPipeline integration (task #6 commit 1)")
struct RecordingPipelineIntegrationTests {

    @Test func dualTrackPipelineProducesTwoTracksAndSidecar() async throws {
        let cap = IntegrationFakeCapture()
        let dir = Self.tempDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let mgr = RecordingManager(
            permissions: IntegrationFakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { AudioEncoder() },
            useDualTrack: true,
            outputDirectory: dir
        )

        try await mgr.startRecording()
        let outputURL = try #require(mgr.currentFileURL)

        // Feed buffers starting at .zero with continuous PTS so the
        // encoder starts the session immediately on the first buffer
        // and the second source landing aborts the 500ms timer. We
        // do NOT trigger Mitigation A (late first frame) here because
        // that path is a documented limitation per task #4.
        let sr: Double = 48_000
        let chunkFrames = AVAudioFrameCount(0.1 * sr)
        var frame: AVAudioFramePosition = 0
        for _ in 0..<5 {
            let sysBuf = try #require(Self.makeSineBuffer(
                freq: 440,
                frames: chunkFrames,
                startFrame: frame,
                sampleRate: sr
            ))
            cap.onRawSystemBuffer?(sysBuf)
            let micBuf = try #require(Self.makeSineBuffer(
                freq: 660,
                frames: chunkFrames,
                startFrame: frame,
                sampleRate: sr
            ))
            cap.onRawMicBuffer?(micBuf)
            frame += AVAudioFramePosition(chunkFrames)
        }

        let finalURL = try await mgr.stopRecording()
        #expect(finalURL == outputURL)
        #expect(mgr.lastError == nil, "no encoder errors expected; got \(String(describing: mgr.lastError))")

        // Read the asset back and validate dual-track + sidecar.
        let asset = AVURLAsset(url: outputURL)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        #expect(audioTracks.count == 2, "dual path must produce 2 audio tracks, got \(audioTracks.count)")

        let sidecarURL = outputURL.deletingPathExtension().appendingPathExtension("tracks.json")
        #expect(FileManager.default.fileExists(atPath: sidecarURL.path), "sidecar must exist for dual path")

        let sidecar = try Self.readSidecar(sidecarURL)
        let systemID = try #require(sidecar["system"])
        let micID = try #require(sidecar["mic"])
        #expect(systemID != micID, "system and mic must map to distinct trackIDs")

        // add() order from AudioEncoder.setupDual is sys then mic, so
        // tracks[0] must be system and tracks[1] must be mic. This is
        // the cross-check against AVAssetWriterTrackOrderProbeTests.
        let trackIDs = audioTracks.map(\.trackID)
        #expect(trackIDs.count == 2)
        #expect(trackIDs[0] == systemID, "first track must be system per add() order")
        #expect(trackIDs[1] == micID, "second track must be mic per add() order")
    }

    @Test func legacyMixedPipelineProducesSingleTrackAndNoSidecar() async throws {
        let cap = IntegrationFakeCapture()
        let dir = Self.tempDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let mgr = RecordingManager(
            permissions: IntegrationFakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { AudioEncoder() },
            useDualTrack: false,
            outputDirectory: dir
        )

        try await mgr.startRecording()
        let outputURL = try #require(mgr.currentFileURL)

        // Feed several legacy mixed PCM chunks. We feed many small
        // chunks instead of one big buffer so writer readiness has
        // time to drain between chunks; a single one-shot push can
        // race with the writer's initial setup.
        let sr: Double = 48_000
        let chunkSamples = Array(repeating: Float(0.2), count: Int(sr * 0.1))
        for _ in 0..<10 {
            cap.onMixedSamples?(chunkSamples)
            try await Task.sleep(nanoseconds: 5_000_000)  // 5 ms
        }
        // Final small yield so the last append makes it into the writer.
        try await Task.sleep(nanoseconds: 30_000_000)

        let finalURL = try await mgr.stopRecording()
        #expect(finalURL == outputURL)
        #expect(mgr.lastError == nil)

        let asset = AVURLAsset(url: outputURL)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        #expect(audioTracks.count == 1, "legacy path must produce exactly one audio track")

        let duration = try await asset.load(.duration)
        #expect(CMTimeGetSeconds(duration) > 0, "legacy track must have non-zero duration")

        // Legacy path must NOT emit a sidecar — sidecar is dualTrack-only.
        let sidecarURL = outputURL.deletingPathExtension().appendingPathExtension("tracks.json")
        #expect(!FileManager.default.fileExists(atPath: sidecarURL.path), "legacy path must not write a sidecar")
    }

    // MARK: - Helpers

    private static func tempDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-pipeline-int-\(UUID().uuidString)", isDirectory: true)
    }

    private static func readSidecar(_ url: URL) throws -> [String: CMPersistentTrackID] {
        let data = try Data(contentsOf: url)
        // docs/06 sidecar contract: flat `{"role": trackID}` — no envelope.
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        var out: [String: CMPersistentTrackID] = [:]
        for (role, value) in raw {
            if let n = value as? NSNumber {
                out[role] = CMPersistentTrackID(n.int32Value)
            }
        }
        return out
    }

    /// Construct a sine-wave `CMSampleBuffer` whose PTS starts at
    /// `startFrame / sampleRate`. Mirrors the helper used in
    /// `AudioEncoderTests` so production encoder gets buffers that
    /// look like SCK output (PCM Float32 mono, ASBD set, packet
    /// descriptions nil — exactly what SCK delivers for `.audio`).
    private static func makeSineBuffer(
        freq: Double,
        frames: AVAudioFrameCount,
        startFrame: AVAudioFramePosition,
        sampleRate: Double
    ) -> CMSampleBuffer? {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            return nil
        }
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        pcm.frameLength = frames
        if let ch = pcm.floatChannelData?[0] {
            let twoPi = 2.0 * .pi
            for i in 0..<Int(frames) {
                let t = Double(Int(startFrame) + i) / sampleRate
                ch[i] = Float(sin(twoPi * freq * t)) * 0.5
            }
        }

        var fmt: CMAudioFormatDescription?
        let fmtStatus = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: format.streamDescription,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &fmt
        )
        guard fmtStatus == noErr, let fmt else { return nil }

        let pts = CMTime(value: CMTimeValue(startFrame), timescale: CMTimeScale(sampleRate))
        var sb: CMSampleBuffer?
        let createStatus = CMAudioSampleBufferCreateWithPacketDescriptions(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: fmt,
            sampleCount: Int(frames),
            presentationTimeStamp: pts,
            packetDescriptions: nil,
            sampleBufferOut: &sb
        )
        guard createStatus == noErr, let sb else { return nil }

        let setStatus = CMSampleBufferSetDataBufferFromAudioBufferList(
            sb,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: pcm.audioBufferList
        )
        guard setStatus == noErr else { return nil }
        return sb
    }
}

// MARK: - Fakes (test-local, deliberately not shared with RecordingManagerTests
// to keep cross-file dependencies minimal — these are small and the
// integration test owns its own fakes for the same reason)

private final class IntegrationFakePermissions: RecordingPermissions, @unchecked Sendable {
    let allGranted: Bool
    var needsSetup: Bool { !allGranted }

    init(allGranted: Bool) { self.allGranted = allGranted }
    func checkAll() async {}
}

private final class IntegrationFakeCapture: AudioCapturing, @unchecked Sendable {
    var availableDevices: [AudioInputDevice] = []
    var selectedDeviceID: String?
    var onMixedSamples: (([Float]) -> Void)?
    var onRawSystemBuffer: ((CMSampleBuffer) -> Void)?
    var onRawMicBuffer: ((CMSampleBuffer) -> Void)?
    var onStreamError: ((Error) -> Void)?

    func refreshDevices() {}
    func startCapture() async throws {}
    func stopCapture() async throws {}
}
