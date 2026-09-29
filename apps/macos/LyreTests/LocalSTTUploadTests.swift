import Foundation
import Testing
@testable import Lyre

private final class STTUploadProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var scenario: STTUploadScenario?
    override static func canInit(with request: URLRequest) -> Bool { true }
    override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        guard let scenario = Self.scenario, let url = request.url else { return }
        let (status, body) = scenario.respond(to: request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
}

private final class STTUploadScenario: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [(String, [String: Any])] = []
    var failFirstCreate = false

    var calls: [(String, [String: Any])] { lock.withLock { requests } }

    func respond(to request: URLRequest) -> (Int, Data) {
        lock.withLock {
            let path = request.url?.path ?? ""
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    data.append(contentsOf: buffer.prefix(count))
                }
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            requests.append((path, body))
            if path == "/api/upload/presign" {
                return (200, Data(#"{"uploadUrl":"https://offline.test/oss","ossKey":"key","recordingId":"stable-id"}"#.utf8))
            }
            if path == "/api/recordings" {
                if failFirstCreate {
                    failFirstCreate = false
                    return (503, Data(#"{"error":"retry"}"#.utf8))
                }
                return (201, Data(#"{"id":"stable-id","title":"Recorded","status":"uploaded"}"#.utf8))
            }
            return (200, Data())
        }
    }
}

@Suite("Local STT upload pipeline", .serialized)
@MainActor
struct LocalSTTUploadTests {
    private struct Context {
        let directory: URL
        let config: AppConfig
        let file: RecordingFile
        let session: URLSession
        let scenario: STTUploadScenario

        func cleanup() {
            session.invalidateAndCancel()
            STTUploadProtocol.scenario = nil
            try? FileManager.default.removeItem(at: directory)
        }
    }

    private func context() throws -> Context {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lyre-stt-upload-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let config = AppConfig(configURL: directory.appendingPathComponent("config.json"))
        config.serverURL = "https://offline.test"
        config.authToken = "offline"
        let url = directory.appendingPathComponent("recording.m4a")
        try Data(repeating: 1, count: 128).write(to: url)
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [STTUploadProtocol.self]
        let scenario = STTUploadScenario()
        STTUploadProtocol.scenario = scenario
        return Context(directory: directory, config: config,
                       file: RecordingFile(url: url, fileSize: 128, createdAt: Date(), duration: 301),
                       session: URLSession(configuration: sessionConfig), scenario: scenario)
    }

    private func manager(
        _ context: Context,
        transcribe: @escaping @Sendable (URL, Double?, LocalSTTSettings) async throws -> LocalTranscription
    ) -> UploadManager {
        UploadManager(config: context.config, session: context.session, transcribe: transcribe, downmix: {
            try FileManager.default.copyItem(at: $0, to: $1)
        })
    }

    private func finish(_ manager: UploadManager) async throws {
        for _ in 0..<250 {
            if !manager.state.isInProgress { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        Issue.record("Upload did not finish")
        manager.cancel()
    }

    @Test func successUploadsSentenceJSONBeforeCloudProcessing() async throws {
        let context = try context()
        defer { context.cleanup() }
        let manager = manager(context) { _, _, settings in
            #expect(settings.enabled)
            #expect(settings.threads == 4)
            return try LocalTranscription.parse(Data(LocalSTTTests.transcript.utf8), duration: 301)
        }
        let library = RecordingLibraryState(config: context.config, startAutomaticUpload: { _, file in
            manager.upload(file: file)
        })
        library.uploadAutomaticallyIfNeeded(context.file)
        try await finish(manager)
        #expect(manager.state == .completed(recordingId: "stable-id"))
        let calls = context.scenario.calls
        #expect(calls.map(\.0) == ["/api/upload/presign", "/oss", "/api/recordings"])
        let body = try #require(calls.last?.1)
        #expect(body["autoTranscribe"] as? Bool == true)
        let transcript = try #require(body["localTranscription"] as? [String: Any])
        let segments = try #require(transcript["transcription"] as? [[String: Any]])
        #expect(segments.count == 2)
        #expect((segments[1]["offsets"] as? [String: Int])?["from"] == 400)
        #expect(manager.localSTTWarning == nil)
    }

    @Test func failedSTTFallsBackAndRetryRetainsRecordingID() async throws {
        let context = try context()
        defer { context.cleanup() }
        context.scenario.failFirstCreate = true
        let manager = manager(context) { _, _, _ in throw LocalSTTError.invalidSettings }
        manager.upload(file: context.file)
        try await finish(manager)
        guard case .failed = manager.state else { Issue.record("Expected first create to fail"); return }
        #expect(manager.localSTTWarning != nil)
        let retry = self.manager(context) { _, _, _ in throw LocalSTTError.invalidSettings }
        retry.upload(file: context.file)
        try await finish(retry)
        #expect(retry.state == .completed(recordingId: "stable-id"))
        let presigns = context.scenario.calls.filter { $0.0 == "/api/upload/presign" }
        #expect(presigns.count == 2)
        #expect(presigns[1].1["recordingId"] as? String == "stable-id")
        let body = try #require(context.scenario.calls.last?.1)
        #expect(body["localTranscription"] == nil)
        #expect(body["autoTranscribe"] as? Bool == true)
    }

    @Test func invalidWhisperOutputFallsBackBeforeCreateRequest() async throws {
        let context = try context()
        defer { context.cleanup() }
        let manager = manager(context) { _, duration, _ in
            let invalid = LocalSTTTests.transcript.replacingOccurrences(of: "large", with: "invalid/model")
            return try LocalTranscription.parse(Data(invalid.utf8), duration: duration)
        }
        manager.upload(file: context.file)
        try await finish(manager)
        #expect(manager.state == .completed(recordingId: "stable-id"))
        #expect(manager.localSTTWarning != nil)
        let body = try #require(context.scenario.calls.last?.1)
        #expect(body["localTranscription"] == nil)
        #expect(body["autoTranscribe"] as? Bool == true)
    }

    @Test func cancelledSTTDoesNotUploadOrFallback() async throws {
        let context = try context()
        defer { context.cleanup() }
        let manager = manager(context) { _, _, _ in
            try await Task.sleep(for: .seconds(30))
            throw LocalSTTError.invalidSettings
        }
        manager.upload(file: context.file)
        for _ in 0..<100 {
            if manager.state == .transcribing { break }
            await Task.yield()
        }
        #expect(manager.state == .transcribing)
        manager.cancel()
        try await Task.sleep(for: .milliseconds(50))
        #expect(manager.state == .idle)
        #expect(manager.localSTTWarning == nil)
        #expect(context.scenario.calls.isEmpty)
    }

    @Test func disablingLocalSTTSkipsRecognition() async throws {
        let context = try context()
        defer { context.cleanup() }
        context.config.localSTT.enabled = false
        let manager = manager(context) { _, _, _ in
            Issue.record("Disabled STT must not run")
            throw LocalSTTError.invalidSettings
        }
        manager.upload(file: context.file)
        try await finish(manager)
        #expect(manager.state == .completed(recordingId: "stable-id"))
        #expect(context.scenario.calls.last?.1["localTranscription"] == nil)
    }
}
