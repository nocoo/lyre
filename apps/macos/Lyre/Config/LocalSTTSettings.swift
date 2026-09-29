import Foundation

struct LocalSTTSettings: Codable, Equatable, Sendable {
    var enabled = true
    var executablePath = "~/workspace/references/whisper.cpp/build/bin/whisper-cli"
    var modelPath = "~/workspace/references/whisper.cpp/models/ggml-large-v3.bin"
    var language = "auto"
    var threads = 4
    var useGPU = true

    var executableURL: URL {
        URL(fileURLWithPath: (executablePath as NSString).expandingTildeInPath)
    }

    var modelURL: URL {
        URL(fileURLWithPath: (modelPath as NSString).expandingTildeInPath)
    }

    func arguments(wav: URL, prefix: URL) throws -> [String] {
        guard (1...64).contains(threads),
              !language.isEmpty, language.utf8.allSatisfy({ (97...122).contains($0) }) else {
            throw LocalSTTError.invalidSettings
        }
        var result = [
            "-m", modelURL.path, "-f", wav.path, "-l", language,
            "-t", String(threads), "-otxt", "-osrt", "-oj", "-pp", "-of", prefix.path,
        ]
        if !useGPU { result.append("-ng") }
        return result
    }
}

enum LocalSTTError: LocalizedError {
    case invalidSettings
    case unavailable(String)
    case processFailed(Int32, String)
    case invalidTranscript

    var errorDescription: String? {
        switch self {
        case .invalidSettings: "Choose a language code and between 1 and 64 CPU threads."
        case .unavailable(let path): "Local STT file is unavailable: \(path)"
        case .processFailed(let code, let log): "Local STT exited with code \(code). Log: \(log)"
        case .invalidTranscript: "Local STT returned no valid timestamped speech."
        }
    }
}
