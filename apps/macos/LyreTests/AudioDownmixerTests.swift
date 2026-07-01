import Testing
import Foundation
import AVFoundation
import CoreMedia
@testable import Lyre

/// Downmix a dual-track M4A (as produced by AudioEncoder .dualTrack) into
/// a single-track M4A suitable for HTML5 <audio>. This is the shape the
/// dashboard player consumes; anything with more than one audio track
/// silently plays only track 0 in Chromium.
@Suite("AudioDownmixer")
struct AudioDownmixerTests {

    // MARK: - Test fixture: build a real dual-track M4A on disk

    /// Build a dual-track M4A the same way UploadManager will consume it
    /// in production: real AudioEncoder in .dualTrack mode, real sine
    /// buffers for both sources.
    private static func makeDualTrackFile(dir: URL) async throws -> URL {
        let outputURL = dir.appendingPathComponent("dual.m4a")
        let encoder = AudioEncoder()
        try encoder.setup(outputURL: outputURL, mode: .dualTrack)

        let sr: Double = 48_000
        let chunkFrames = AVAudioFrameCount(0.1 * sr)
        var frame: AVAudioFramePosition = 0
        for _ in 0..<5 {
            let sysBuf = try #require(Self.makeSineBuffer(
                freq: 440, frames: chunkFrames,
                startFrame: frame, sampleRate: sr
            ))
            _ = try encoder.enqueue(sysBuf, source: AudioEncoder.Source.system)
            let micBuf = try #require(Self.makeSineBuffer(
                freq: 660, frames: chunkFrames,
                startFrame: frame, sampleRate: sr
            ))
            _ = try encoder.enqueue(micBuf, source: AudioEncoder.Source.mic)
            frame += AVAudioFramePosition(chunkFrames)
        }

        try await encoder.finalize()
        return outputURL
    }

    // MARK: - Tests

    @Test func downmixCollapsesTwoTracksIntoOne() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downmix-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let source = try await Self.makeDualTrackFile(dir: dir)
        // Sanity check: fixture must be dual-track for this test to mean anything.
        let sourceAsset = AVURLAsset(url: source)
        let sourceTracks = try await sourceAsset.loadTracks(withMediaType: .audio)
        #expect(sourceTracks.count == 2, "fixture must produce a dual-track file")

        let dest = dir.appendingPathComponent("mixed.m4a")
        try await AudioDownmixer.downmix(source: source, destination: dest)

        let destAsset = AVURLAsset(url: dest)
        let destTracks = try await destAsset.loadTracks(withMediaType: .audio)
        #expect(destTracks.count == 1, "downmix must collapse into a single audio track")
    }

    @Test func downmixPreservesDurationApproximately() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downmix-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let source = try await Self.makeDualTrackFile(dir: dir)
        let dest = dir.appendingPathComponent("mixed.m4a")
        try await AudioDownmixer.downmix(source: source, destination: dest)

        let sourceAsset = AVURLAsset(url: source)
        let destAsset = AVURLAsset(url: dest)
        let sourceDuration = try await sourceAsset.load(.duration).seconds
        let destDuration = try await destAsset.load(.duration).seconds

        // AAC frame boundaries + PTS quantization: allow ~50ms slack.
        let delta = abs(sourceDuration - destDuration)
        #expect(delta < 0.1, "duration drift too large: source=\(sourceDuration) dest=\(destDuration)")
    }

    @Test func downmixProducesFaststartOutput() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downmix-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let source = try await Self.makeDualTrackFile(dir: dir)
        let dest = dir.appendingPathComponent("mixed.m4a")
        try await AudioDownmixer.downmix(source: source, destination: dest)

        // Read raw bytes and scan top-level atoms — moov must come before
        // mdat for browsers to decode metadata off a single Range request.
        let data = try Data(contentsOf: dest)
        let (moovOffset, mdatOffset) = try Self.scanAtomOffsets(data: data)
        #expect(moovOffset != nil, "output must contain a moov atom")
        #expect(mdatOffset != nil, "output must contain an mdat atom")
        if let m = moovOffset, let d = mdatOffset {
            #expect(m < d, "moov (\(m)) must precede mdat (\(d)) for faststart")
        }
    }

    @Test func singleTrackSourceCopiesUnchanged() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downmix-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        // Build a single-track (legacyMixed) source instead of dual.
        let source = dir.appendingPathComponent("single.m4a")
        let encoder = AudioEncoder()
        try encoder.setup(outputURL: source, mode: .legacyMixed)
        let chunkCount = 3
        let chunkSamples = 4800 // 100ms at 48 kHz
        for _ in 0..<chunkCount {
            let samples = (0..<chunkSamples).map { i -> Float in
                let t = Double(i) / 48_000
                return Float(sin(2 * .pi * 440 * t)) * 0.5
            }
            _ = encoder.encodeSamples(samples)
        }
        try await encoder.finalize()

        let dest = dir.appendingPathComponent("mixed.m4a")
        try await AudioDownmixer.downmix(source: source, destination: dest)

        // Fast-path: byte-identical copy.
        let srcBytes = try Data(contentsOf: source)
        let dstBytes = try Data(contentsOf: dest)
        #expect(srcBytes == dstBytes, "single-track source must be copied byte-identical")
    }

    @Test func downmixOverwritesExistingDestination() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downmix-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let source = try await Self.makeDualTrackFile(dir: dir)
        let dest = dir.appendingPathComponent("mixed.m4a")

        // Pre-existing content that must be replaced.
        try Data("stale".utf8).write(to: dest)

        try await AudioDownmixer.downmix(source: source, destination: dest)

        let asset = AVURLAsset(url: dest)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        #expect(tracks.count == 1, "stale destination must be overwritten with fresh output")
    }

    // MARK: - Helpers

    /// Locate the top-level moov and mdat offsets in an ISO-BMFF file
    /// (M4A). Assumes size fits in 32 bits — good enough for our test
    /// fixtures which are well under 4 GiB.
    private static func scanAtomOffsets(data: Data) throws -> (moov: Int?, mdat: Int?) {
        var offset = 0
        var moov: Int?
        var mdat: Int?
        while offset + 8 <= data.count {
            let size = Int(UInt32(bigEndian: data.withUnsafeBytes {
                $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self)
            }))
            let type = String(data: data.subdata(in: (offset + 4)..<(offset + 8)), encoding: .ascii) ?? ""
            if type == "moov", moov == nil { moov = offset }
            if type == "mdat", mdat == nil { mdat = offset }
            if size < 8 { break }
            offset += size
        }
        return (moov, mdat)
    }

    /// Same sine-wave CMSampleBuffer helper used by
    /// RecordingPipelineIntegrationTests — kept local here so this
    /// suite stays self-contained.
    private static func makeSineBuffer(
        freq: Double,
        frames: AVAudioFrameCount,
        startFrame: AVAudioFramePosition,
        sampleRate: Double
    ) -> CMSampleBuffer? {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else { return nil }
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
            layoutSize: 0, layout: nil,
            magicCookieSize: 0, magicCookie: nil,
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
