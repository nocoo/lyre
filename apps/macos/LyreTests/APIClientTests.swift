import Testing
import Foundation
@testable import Lyre

// MARK: - Mock URLProtocol

/// Intercepts all URLSession requests for deterministic testing.
final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    /// Handler called for every request. Set before each test.
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Data, HTTPURLResponse))?

    override static func canInit(with request: URLRequest) -> Bool { true }
    override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            fatalError("MockURLProtocol.handler not set")
        }

        let (data, response) = handler(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

// MARK: - Test Helpers

private func makeSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    return URLSession(configuration: config)
}

private func makeClient(
    baseURL: String = "https://lyre.test",
    authToken: String = "test-token"
) -> APIClient {
    APIClient(baseURL: baseURL, authToken: authToken, session: makeSession())
}

private func jsonResponse(
    _ json: Any,
    status: Int = 200,
    url: String = "https://lyre.test"
) -> (Data, HTTPURLResponse) {
    let data = (try? JSONSerialization.data(withJSONObject: json)) ?? Data()
    let response = HTTPURLResponse(
        url: URL(string: url)!,
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
    )!
    return (data, response)
}

// MARK: - Tests

@Suite("APIClient Tests", .serialized)
struct APIClientTests {

    // MARK: - Init

    @Test func initTrimsBaseURL() async {
        let client = makeClient(baseURL: "  https://lyre.test/  ")
        let url = await client.baseURL
        #expect(url == "https://lyre.test")
    }

    @Test func initTrimsAuthToken() async {
        let client = makeClient(authToken: "  tok_abc  ")
        let token = await client.authToken
        #expect(token == "tok_abc")
    }

    // MARK: - checkLive

    @Test func checkLiveSuccess() async throws {
        MockURLProtocol.handler = { request in
            #expect(request.url?.path == "/api/live")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            return jsonResponse(["status": "ok", "version": "1.2.3"])
        }

        let client = makeClient()
        let response = try await client.checkLive()
        #expect(response.status == "ok")
        #expect(response.version == "1.2.3")
    }

    @Test func checkLiveHTTPError() async {
        MockURLProtocol.handler = { _ in
            jsonResponse(["error": "not found"], status: 404)
        }

        let client = makeClient()
        do {
            _ = try await client.checkLive()
            Issue.record("Expected APIError")
        } catch let error as APIClient.APIError {
            #expect(error == .httpError(404, "not found"))
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    // MARK: - presign

    @Test func presignSuccess() async throws {
        MockURLProtocol.handler = { request in
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path == "/api/upload/presign")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")

            // Note: URLProtocol may strip httpBody; verify via httpBodyStream if needed
            if let body = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: body) as? [String: String] {
                #expect(json["fileName"] == "test.m4a")
                #expect(json["contentType"] == "audio/x-m4a")
            }

            return jsonResponse([
                "uploadUrl": "https://oss.example.com/upload",
                "ossKey": "recordings/abc.m4a",
                "recordingId": "rec_123"
            ])
        }

        let client = makeClient()
        let response = try await client.presign(fileName: "test.m4a", contentType: "audio/x-m4a")
        #expect(response.uploadUrl == "https://oss.example.com/upload")
        #expect(response.ossKey == "recordings/abc.m4a")
        #expect(response.recordingId == "rec_123")
    }

    // MARK: - uploadToOSS

    @Test func uploadToOSSSuccess() async throws {
        let uploadData = Data(repeating: 0xAB, count: 256)

        MockURLProtocol.handler = { request in
            #expect(request.httpMethod == "PUT")
            #expect(request.url?.absoluteString == "https://oss.example.com/upload")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "audio/x-m4a")
            // No Bearer auth for OSS
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            return jsonResponse([:])
        }

        let client = makeClient()
        try await client.uploadToOSS(
            uploadURL: "https://oss.example.com/upload",
            data: uploadData,
            contentType: "audio/x-m4a"
        )
    }

    @Test func uploadToOSSInvalidURL() async {
        let client = makeClient()
        do {
            try await client.uploadToOSS(uploadURL: "", data: Data(), contentType: "audio/x-m4a")
            Issue.record("Expected APIError")
        } catch let error as APIClient.APIError {
            if case .invalidURL = error {
                // Expected
            } else {
                Issue.record("Expected invalidURL, got \(error)")
            }
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test func uploadToOSSHTTPError() async {
        MockURLProtocol.handler = { _ in
            jsonResponse([:], status: 403)
        }

        let client = makeClient()
        do {
            try await client.uploadToOSS(
                uploadURL: "https://oss.example.com/upload",
                data: Data(repeating: 0, count: 10),
                contentType: "audio/x-m4a"
            )
            Issue.record("Expected APIError")
        } catch let error as APIClient.APIError {
            #expect(error == .httpError(403, "OSS upload failed"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    // MARK: - createRecording

    @Test func createRecordingSuccess() async throws {
        MockURLProtocol.handler = { request in
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path == "/api/recordings")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")

            return jsonResponse([
                "id": "rec_123",
                "title": "My Recording",
                "status": "pending"
            ])
        }

        let client = makeClient()
        let response = try await client.createRecording(
            APIClient.CreateRecordingRequest(
                id: "rec_123",
                title: "My Recording",
                fileName: "test.m4a",
                ossKey: "recordings/abc.m4a",
                fileSize: 1024,
                duration: 60.0,
                format: "m4a",
                sampleRate: 48000,
                tags: ["tag1"],
                folderId: "folder1",
                recordedAt: 1700000000000
            )
        )
        #expect(response.id == "rec_123")
        #expect(response.title == "My Recording")
        #expect(response.status == "pending")
    }

    // MARK: - listFolders

    @Test func listFoldersSuccess() async throws {
        MockURLProtocol.handler = { request in
            #expect(request.url?.path == "/api/folders")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")

            return jsonResponse([
                "items": [
                    ["id": "f1", "name": "Work", "icon": "briefcase"],
                    ["id": "f2", "name": "Personal", "icon": "house"]
                ]
            ])
        }

        let client = makeClient()
        let folders = try await client.listFolders()
        #expect(folders.count == 2)
        #expect(folders[0].name == "Work")
        #expect(folders[1].id == "f2")
    }

    @Test func listFoldersEmpty() async throws {
        MockURLProtocol.handler = { _ in
            jsonResponse(["items": []])
        }

        let client = makeClient()
        let folders = try await client.listFolders()
        #expect(folders.isEmpty)
    }

    // MARK: - listTags

    @Test func listTagsSuccess() async throws {
        MockURLProtocol.handler = { request in
            #expect(request.url?.path == "/api/tags")

            return jsonResponse([
                "items": [
                    ["id": "t1", "name": "Meeting"],
                    ["id": "t2", "name": "Interview"]
                ]
            ])
        }

        let client = makeClient()
        let tags = try await client.listTags()
        #expect(tags.count == 2)
        #expect(tags[0].name == "Meeting")
    }

    // MARK: - Error handling

    @Test func httpErrorExtractsJSONMessage() async {
        MockURLProtocol.handler = { _ in
            jsonResponse(["error": "Unauthorized"], status: 401)
        }

        let client = makeClient()
        do {
            _ = try await client.checkLive()
            Issue.record("Expected error")
        } catch let error as APIClient.APIError {
            #expect(error == .httpError(401, "Unauthorized"))
        } catch {
            Issue.record("Unexpected: \(error)")
        }
    }

    @Test func httpErrorFallsBackToBody() async {
        MockURLProtocol.handler = { _ in
            let data = Data("plain text error".utf8)
            let response = HTTPURLResponse(
                url: URL(string: "https://lyre.test/api/live")!,
                statusCode: 500,
                httpVersion: nil,
                headerFields: nil
            )!
            return (data, response)
        }

        let client = makeClient()
        do {
            _ = try await client.checkLive()
            Issue.record("Expected error")
        } catch let error as APIClient.APIError {
            #expect(error == .httpError(500, "plain text error"))
        } catch {
            Issue.record("Unexpected: \(error)")
        }
    }

    @Test func decodingErrorOnMalformedJSON() async {
        MockURLProtocol.handler = { _ in
            let data = Data("{}".utf8)
            let response = HTTPURLResponse(
                url: URL(string: "https://lyre.test/api/live")!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (data, response)
        }

        let client = makeClient()
        do {
            // checkLive expects { status: String } — {} should fail decoding
            _ = try await client.checkLive()
            Issue.record("Expected decoding error")
        } catch let error as APIClient.APIError {
            if case .decodingError = error {
                // Expected
            } else {
                Issue.record("Expected decodingError, got \(error)")
            }
        } catch {
            Issue.record("Unexpected: \(error)")
        }
    }
}
