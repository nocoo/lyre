import CryptoKit
import Foundation

enum LocalSTT {
    static func artifactDirectory(source: URL, serverURL: String = "") throws -> URL {
        let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
        let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let identity = "\(source.standardizedFileURL.path)|\(attributes[.size] ?? 0)|\(modified)|\(serverURL)"
        let digest = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return source.deletingLastPathComponent().appendingPathComponent(".lyre-stt", isDirectory: true)
            .appendingPathComponent(digest, isDirectory: true)
    }

    static func transcribe(
        source: URL, duration: Double?, settings: LocalSTTSettings
    ) async throws -> LocalTranscription {
        try Task.checkCancellation()
        let directory = try artifactDirectory(source: source)
        let cachedJSON = directory.appendingPathComponent("transcript.json")
        let cachedSettings = directory.appendingPathComponent("settings.json")
        if let data = try? Data(contentsOf: cachedJSON),
           let settingsData = try? Data(contentsOf: cachedSettings),
           let previous = try? JSONDecoder().decode(LocalSTTSettings.self, from: settingsData),
           previous == settings,
           let cached = try? LocalTranscription.parse(data, duration: duration) {
            return cached
        }
        guard FileManager.default.isExecutableFile(atPath: settings.executableURL.path) else {
            throw LocalSTTError.unavailable(settings.executableURL.path)
        }
        guard FileManager.default.isReadableFile(atPath: settings.modelURL.path) else {
            throw LocalSTTError.unavailable(settings.modelURL.path)
        }
        let run = directory.appendingPathComponent("run-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: run, withIntermediateDirectories: true)
        let wav = run.appendingPathComponent("mixed.wav")
        let prefix = run.appendingPathComponent("transcript")
        let arguments = try settings.arguments(wav: wav, prefix: prefix)
        try await AudioDownmixer.makeWhisperWAV(source: source, destination: wav)
        try await runProcess(executable: settings.executableURL, arguments: arguments,
                             log: run.appendingPathComponent("stderr.log"))
        let data = try Data(contentsOf: prefix.appendingPathExtension("json"))
        let transcript = try LocalTranscription.parse(data, duration: duration)
        try Task.checkCancellation()
        do {
            try data.write(to: cachedJSON, options: .atomic)
            try JSONEncoder().encode(settings).write(to: cachedSettings, options: .atomic)
        } catch {
            try? FileManager.default.removeItem(at: cachedSettings)
        }
        return transcript
    }

    static func runProcess(executable: URL, arguments: [String], log: URL) async throws {
        try Task.checkCancellation()
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let output = try FileHandle(forWritingTo: log)
        defer { try? output.close() }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = output
        try process.run()
        do {
            while process.isRunning { try await Task.sleep(for: .milliseconds(100)) }
            try Task.checkCancellation()
        } catch {
            if process.isRunning { process.terminate() }
            throw error
        }
        guard process.terminationStatus == 0 else {
            throw LocalSTTError.processFailed(process.terminationStatus, log.path)
        }
    }
}
