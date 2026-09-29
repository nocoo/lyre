import Foundation

struct LocalTranscription: Codable, Sendable {
    struct Result: Codable, Sendable {
        let language: String
    }

    struct Segment: Codable, Sendable {
        struct Offsets: Codable, Sendable {
            let from: Int
            let to: Int
        }
        let offsets: Offsets
        let text: String
    }

    struct Model: Codable, Sendable {
        let type: String?
    }

    let result: Result
    let transcription: [Segment]
    let model: Model?

    static func parse(_ data: Data, duration: Double?) throws -> Self {
        guard data.count <= 5 * 1024 * 1024 else { throw LocalSTTError.invalidTranscript }
        let value = try JSONDecoder().decode(Self.self, from: data)
        let whitespace = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}"))
        guard !value.result.language.trimmingCharacters(in: whitespace).isEmpty,
              value.result.language.utf16.count <= 32, value.transcription.count <= 50_000 else {
            throw LocalSTTError.invalidTranscript
        }
        if let duration, !duration.isFinite || duration < 0 { throw LocalSTTError.invalidTranscript }
        if let model = value.model?.type,
           model.range(of: #"^[a-zA-Z0-9._ -]{1,128}$"#, options: .regularExpression) == nil {
            throw LocalSTTError.invalidTranscript
        }
        var previousStart = 0
        var previousEnd = 0
        for segment in value.transcription {
            guard segment.text.utf16.count <= 100_000,
                  segment.offsets.from >= 0, segment.offsets.to >= segment.offsets.from,
                  segment.offsets.to <= 9_007_199_254_740_991,
                  segment.offsets.from >= previousStart, segment.offsets.to >= previousEnd else {
                throw LocalSTTError.invalidTranscript
            }
            if let duration, Double(segment.offsets.to) > duration * 1000 + 1000 {
                throw LocalSTTError.invalidTranscript
            }
            previousStart = segment.offsets.from
            previousEnd = segment.offsets.to
        }
        return value
    }
}
