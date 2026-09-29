import AVFoundation
import Foundation
import Testing
@testable import Lyre

@Suite("Local STT")
struct LocalSTTTests {
    static let transcript = """
    {"result":{"language":"zh"},"model":{"type":"large"},"transcription":[
    {"text":" First sentence.","offsets":{"from":0,"to":400}},
    {"text":" Second sentence.","offsets":{"from":400,"to":800}}]}
    """

    @Test func argumentsUseRequestedWhisperOutputsWithoutShellInterpolation() throws {
        var settings = LocalSTTSettings()
        settings.modelPath = "/tmp/a model;$(echo bad).bin"
        let arguments = try settings.arguments(wav: URL(fileURLWithPath: "/tmp/mixed.wav"),
                                               prefix: URL(fileURLWithPath: "/tmp/transcript"))
        #expect(arguments == ["-m", settings.modelPath, "-f", "/tmp/mixed.wav", "-l", "auto", "-t", "4",
                              "-otxt", "-osrt", "-oj", "-pp", "-of", "/tmp/transcript"])
        settings.useGPU = false
        #expect(try settings.arguments(wav: URL(fileURLWithPath: "/a"),
                                        prefix: URL(fileURLWithPath: "/b")).last == "-ng")
        settings.threads = 0
        #expect(throws: LocalSTTError.self) {
            try settings.arguments(wav: URL(fileURLWithPath: "/a"), prefix: URL(fileURLWithPath: "/b"))
        }
        settings.threads = 4
        settings.language = "-f"
        #expect(throws: LocalSTTError.self) {
            try settings.arguments(wav: URL(fileURLWithPath: "/a"), prefix: URL(fileURLWithPath: "/b"))
        }
    }

    @Test func validatesSentenceOffsetsAndAcceptsSilence() throws {
        let value = try LocalTranscription.parse(Data(Self.transcript.utf8), duration: 1)
        #expect(value.result.language == "zh")
        #expect(value.transcription[1].offsets.from == 400)
        #expect(value.transcription[1].text == " Second sentence.")
        #expect(value.model?.type == "large")
        let silent = Data(#"{"result":{"language":"en"},"transcription":[]}"#.utf8)
        #expect(try LocalTranscription.parse(silent, duration: 0).transcription.isEmpty)
        for replacement in ["-1", "9000"] {
            let bad = Self.transcript.replacingOccurrences(of: "\"to\":800", with: "\"to\":\(replacement)")
            #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(Data(bad.utf8), duration: 1) }
        }
        let backwards = Self.transcript.replacingOccurrences(of: "\"from\":400", with: "\"from\":-1")
        #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(Data(backwards.utf8), duration: 1) }
    }

    @Test func enforcesServerStringAndSegmentLimitsInUTF16() throws {
        let valid = try payload(language: String(repeating: "😀", count: 16),
                                text: String(repeating: "😀", count: 50_000))
        #expect(try LocalTranscription.parse(valid, duration: 0).transcription.count == 1)
        let tooLongLanguage = try payload(language: String(repeating: "😀", count: 17))
        let tooLongText = try payload(text: String(repeating: "😀", count: 50_001))
        let tooManySegments = try payload(count: 50_001)
        let blankLanguage = try payload(language: "\u{FEFF}")
        for data in [tooLongLanguage, tooLongText, tooManySegments, blankLanguage] {
            #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(data, duration: 0) }
        }
        #expect(try LocalTranscription.parse(payload(count: 50_000), duration: 0).transcription.count == 50_000)
    }

    @Test func rejectsOversizedJSONAndInvalidModelNames() throws {
        var oversized = try #require(try JSONSerialization.jsonObject(with: payload()) as? [String: Any])
        oversized["padding"] = String(repeating: "a", count: 5 * 1024 * 1024)
        let data = try JSONSerialization.data(withJSONObject: oversized)
        #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(data, duration: 0) }
        for model in ["", "../model", "large:3", "模型", String(repeating: "a", count: 129)] {
            let invalid = try payload(model: model)
            #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(invalid, duration: 0) }
        }
        for model in ["large-v3", "large v3", String(repeating: "a", count: 128)] {
            #expect(try LocalTranscription.parse(payload(model: model), duration: 0).model?.type == model)
        }
        #expect(try LocalTranscription.parse(payload(model: nil), duration: 0).model?.type == nil)
    }

    @Test func rejectsUnsafeMillisecondsAndInvalidDuration() throws {
        let valid = try payload(end: 9_007_199_254_740_991)
        #expect(try LocalTranscription.parse(valid, duration: nil).transcription[0].offsets.to == 9_007_199_254_740_991)
        let invalid = try payload(end: 9_007_199_254_740_992)
        #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(invalid, duration: nil) }
        for duration in [-1, Double.nan, .infinity, -.infinity] {
            #expect(throws: LocalSTTError.self) { try LocalTranscription.parse(payload(), duration: duration) }
        }
    }

    private func payload(
        language: String = "en", text: String = "", model: String? = "large", end: Int = 0, count: Int = 1
    ) throws -> Data {
        let segment = LocalTranscription.Segment(offsets: .init(from: 0, to: end), text: text)
        return try JSONEncoder().encode(LocalTranscription(result: .init(language: language),
            transcription: Array(repeating: segment, count: count), model: .init(type: model)))
    }

    @Test func storesRawOutputsAndReusesSuccessfulRecognition() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = try makeAudio(in: directory)
        let script = directory.appendingPathComponent("whisper-cli")
        let scriptText = """
        #!/bin/sh
        while [ "$#" -gt 0 ]; do
          if [ "$1" = "-of" ]; then shift; prefix="$1"; fi
          shift
        done
        cat > "$prefix.json" <<'JSON'
        \(Self.transcript)
        JSON
        printf 'First sentence. Second sentence.' > "$prefix.txt"
        printf '1\\n00:00:00,000 --> 00:00:00,400\\nFirst sentence.' > "$prefix.srt"
        printf 'recognition finished' >&2
        """
        try scriptText.write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        var settings = LocalSTTSettings()
        settings.executablePath = script.path
        settings.modelPath = source.path
        let value = try await LocalSTT.transcribe(source: source, duration: 1, settings: settings)
        #expect(value.transcription.count == 2)
        let artifacts = try LocalSTT.artifactDirectory(source: source)
        let files = try FileManager.default.contentsOfDirectory(at: artifacts, includingPropertiesForKeys: nil)
        let run = try #require(files.first { $0.lastPathComponent.hasPrefix("run-") })
        for name in ["mixed.wav", "transcript.json", "transcript.txt", "transcript.srt", "stderr.log"] {
            #expect(FileManager.default.fileExists(atPath: run.appendingPathComponent(name).path))
        }
        let wav = try AVAudioFile(forReading: run.appendingPathComponent("mixed.wav"))
        #expect(wav.fileFormat.sampleRate == 16_000)
        #expect(wav.fileFormat.channelCount == 1)
        try FileManager.default.removeItem(at: script)
        let cached = try await LocalSTT.transcribe(source: source, duration: 1, settings: settings)
        #expect(cached.transcription.count == 2)
    }

    @Test func processFailureAndCancellationAreDistinct() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("stderr.log")
        await #expect(throws: LocalSTTError.self) {
            try await LocalSTT.runProcess(executable: URL(fileURLWithPath: "/usr/bin/false"), arguments: [], log: log)
        }
        let task = Task {
            try await LocalSTT.runProcess(executable: URL(fileURLWithPath: "/bin/sleep"), arguments: ["30"], log: log)
        }
        try await Task.sleep(for: .milliseconds(150))
        task.cancel()
        do {
            try await task.value
            Issue.record("Cancellation must throw")
        } catch is CancellationError {
        } catch {
            Issue.record("Unexpected cancellation result: \(error)")
        }
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lyre-stt-test-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func makeAudio(in directory: URL) throws -> URL {
        let source = directory.appendingPathComponent("source.wav")
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48_000))
        buffer.frameLength = 48_000
        let samples = try #require(buffer.floatChannelData?[0])
        for index in 0..<48_000 { samples[index] = Float(sin(Double(index) / 48_000 * 880 * .pi)) * 0.3 }
        let file = try AVAudioFile(forWriting: source, settings: format.settings)
        try file.write(from: buffer)
        return source
    }
}
