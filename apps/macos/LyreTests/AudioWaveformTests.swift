import AVFoundation
import Testing
@testable import Lyre

@Suite("Waveform overview")
struct AudioWaveformTests {
    @Test func waveformIncludesTheMicrophoneTrackAndLeavesTheFileUntouched() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lyre-wave-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("dual.m4a")
        let encoder = AudioEncoder(sampleRate: 48_000, channelCount: 1, bitRate: 64_000)
        try encoder.setup(outputURL: url, mode: .dualTrack)
        // A silent first track catches regressions that accidentally inspect only system audio.
        _ = try encoder.enqueue(AudioEncoderDualTrackTests.makeSineBuffer(
            freq: 0, durationSeconds: 0.6, startPTS: .zero
        ), source: .system)
        _ = try encoder.enqueue(AudioEncoderDualTrackTests.makeSineBuffer(
            freq: 0, durationSeconds: 0.3, startPTS: .zero
        ), source: .mic)
        _ = try encoder.enqueue(AudioEncoderDualTrackTests.makeSineBuffer(
            freq: 880, durationSeconds: 0.3, startPTS: CMTime(seconds: 0.3, preferredTimescale: 48_000)
        ), source: .mic)
        try await encoder.finalize()
        let original = try Data(contentsOf: url)
        let peaks = try await AudioWaveform.load(url: url, count: 24)
        #expect(peaks.count == 24)
        #expect(peaks.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 })
        #expect(peaks.prefix(6).allSatisfy { $0 < 0.02 })
        #expect(peaks.suffix(6).contains { $0 > 0.7 })
        #expect(try Data(contentsOf: url) == original)

        let task = Task { try await AudioWaveform.load(url: url) }
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test func unreadableFileFailsWithoutInventingAWaveform() async {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("missing-\(UUID()).m4a")
        await #expect(throws: (any Error).self) { try await AudioWaveform.load(url: url) }
    }
}
