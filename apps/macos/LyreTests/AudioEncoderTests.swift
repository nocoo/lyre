import AVFoundation
import Testing
@testable import Lyre

@Suite("AudioEncoder Tests")
struct AudioEncoderTests {

    // MARK: - Init

    @Test func defaultParameters() {
        let encoder = AudioEncoder()
        #expect(encoder.isWriting == false)
    }

    @Test func customParameters() {
        let encoder = AudioEncoder(sampleRate: 44100, channelCount: 2, bitRate: 256_000)
        #expect(encoder.isWriting == false)
    }

    // MARK: - Setup

    @Test func setupCreatesWriter() throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)
        #expect(encoder.isWriting == true)
    }

    @Test func setupInvalidPathThrows() {
        let encoder = AudioEncoder()
        // A URL pointing to a non-existent nested directory should fail
        let url = URL(fileURLWithPath: "/nonexistent/path/test.m4a")
        do {
            try encoder.setup(outputURL: url)
            Issue.record("Expected EncoderError.setupFailed")
        } catch is AudioEncoder.EncoderError {
            // Expected
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    // MARK: - Sample Buffer Creation

    @Test func createSampleBufferWithEmptySamplesReturnsNil() {
        let encoder = AudioEncoder()
        let result = encoder.createSampleBuffer(from: [])
        #expect(result == nil)
    }

    @Test func createSampleBufferWithoutSetupReturnsNil() {
        let encoder = AudioEncoder()
        let result = encoder.createSampleBuffer(from: [0.1, 0.2, 0.3])
        #expect(result == nil)
    }

    @Test func createSampleBufferAfterSetup() throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)
        let buffer = encoder.createSampleBuffer(from: [0.1, 0.2, 0.3])
        #expect(buffer != nil)
    }

    // MARK: - Encode Samples

    @Test func encodeSamplesWithoutSetupReturnsFalse() {
        let encoder = AudioEncoder()
        let result = encoder.encodeSamples([0.1, 0.2])
        #expect(result == false)
    }

    @Test func encodeSamplesAfterSetupReturnsTrue() throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)
        let result = encoder.encodeSamples([0.1, 0.2, 0.3, 0.4])
        #expect(result == true)
    }

    @Test func encodeSamplesEmpty() throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)
        // Empty samples should return false (createSampleBuffer returns nil)
        let result = encoder.encodeSamples([])
        #expect(result == false)
    }

    // MARK: - Finalize

    @Test func finalizeWithoutSetupDoesNotCrash() async {
        let encoder = AudioEncoder()
        await encoder.finalize()
        #expect(encoder.isWriting == false)
    }

    @Test func finalizeClosesWriter() async throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)
        #expect(encoder.isWriting == true)
        // Write some samples first
        encoder.encodeSamples([0.1, 0.2, 0.3])
        await encoder.finalize()
        #expect(encoder.isWriting == false)
        // File should exist
        #expect(FileManager.default.fileExists(atPath: url.path))
    }

    @Test func encodeSamplesAfterFinalizeReturnsFalse() async throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)
        encoder.encodeSamples([0.1, 0.2])
        await encoder.finalize()
        let result = encoder.encodeSamples([0.3, 0.4])
        #expect(result == false)
    }

    // MARK: - Error Descriptions

    @Test func errorDescriptions() {
        let errors: [(AudioEncoder.EncoderError, String)] = [
            (.setupFailed("test"), "Encoder setup failed: test"),
            (.writerFailed("oops"), "Encoder write failed: oops"),
        ]
        for (error, expected) in errors {
            #expect(error.localizedDescription == expected)
        }
    }

    @Test func errorEquality() {
        #expect(AudioEncoder.EncoderError.setupFailed("a") == .setupFailed("a"))
        #expect(AudioEncoder.EncoderError.setupFailed("a") != .setupFailed("b"))
        #expect(AudioEncoder.EncoderError.writerFailed("x") == .writerFailed("x"))
    }

    // MARK: - Thread Safety

    @Test func concurrentEncodeSamplesDoesNotCrash() throws {
        let encoder = AudioEncoder()
        let url = makeTemporaryURL()
        try encoder.setup(outputURL: url)

        // Simulate concurrent writes from multiple threads
        let iterations = 100
        let group = DispatchGroup()
        let queues = (0..<4).map {
            DispatchQueue(label: "test-thread-\($0)")
        }

        for i in 0..<iterations {
            group.enter()
            queues[i % queues.count].async {
                let samples = [Float](repeating: Float(i) * 0.001, count: 480)
                encoder.encodeSamples(samples)
                group.leave()
            }
        }
        group.wait()

        // Should still be writing (not crashed or corrupted)
        #expect(encoder.isWriting == true)
    }

    // MARK: - Helpers

    private func makeTemporaryURL() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-encoder-test-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("test.m4a")
    }
}
