import Foundation
import os

/// HTTP client for the Lyre web API.
///
/// Uses URLSession with async/await. All requests include Bearer token auth
/// (except `/api/live` which is public).
actor APIClient {
    private static let logger = Logger(subsystem: "com.lyre.app", category: "APIClient")

    let baseURL: String
    let authToken: String

    init(baseURL: String, authToken: String) {
        self.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.authToken = authToken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Errors

    enum APIError: LocalizedError, Equatable {
        case invalidURL(String)
        case httpError(Int, String)
        case decodingError(String)
        case networkError(String)

        var errorDescription: String? {
            switch self {
            case .invalidURL(let url):
                return "Invalid URL: \(url)"
            case .httpError(let code, let message):
                return "HTTP \(code): \(message)"
            case .decodingError(let detail):
                return "Failed to decode response: \(detail)"
            case .networkError(let detail):
                return "Network error: \(detail)"
            }
        }
    }

    // MARK: - Models

    struct LiveResponse: Codable, Sendable {
        let status: String
        let version: String?
        let timestamp: Int?
    }

    struct PresignRequest: Codable, Sendable {
        let fileName: String
        let contentType: String
    }

    struct PresignResponse: Codable, Sendable {
        let uploadUrl: String
        let ossKey: String
        let recordingId: String
    }

    struct CreateRecordingRequest: Codable, Sendable {
        let id: String?
        let title: String
        let fileName: String
        let ossKey: String
        let fileSize: Int64?
        let duration: Double?
        let format: String?
        let sampleRate: Int?
        let tags: [String]?
        let folderId: String?
        let recordedAt: Int64?
    }

    struct RecordingResponse: Codable, Sendable {
        let id: String
        let title: String
        let status: String
    }

    struct Folder: Codable, Sendable, Identifiable {
        let id: String
        let name: String
        let icon: String
    }

    struct Tag: Codable, Sendable, Identifiable {
        let id: String
        let name: String
    }

    struct ItemsResponse<T: Codable & Sendable>: Codable, Sendable {
        let items: [T]
    }

    // MARK: - Public API

    /// Check server connectivity (public endpoint, no auth required).
    func checkLive() async throws -> LiveResponse {
        let url = try buildURL("/api/live")
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        return try await perform(request)
    }

    /// Get presigned upload URL.
    func presign(fileName: String, contentType: String) async throws -> PresignResponse {
        let url = try buildURL("/api/upload/presign")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)

        let body = PresignRequest(fileName: fileName, contentType: contentType)
        request.httpBody = try JSONEncoder().encode(body)

        return try await perform(request)
    }

    /// Upload file data directly to OSS using the presigned URL.
    ///
    /// This does NOT use Bearer auth — the URL itself contains the signature.
    func uploadToOSS(uploadURL: String, data: Data, contentType: String) async throws {
        guard let url = URL(string: uploadURL) else {
            throw APIError.invalidURL(uploadURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 300 // 5 minutes for large files

        let (_, response) = try await URLSession.shared.upload(for: request, from: data)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError("Invalid response from OSS")
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode, "OSS upload failed")
        }

        Self.logger.info("OSS upload succeeded (\(data.count) bytes)")
    }

    /// Create a recording in the database.
    func createRecording(_ req: CreateRecordingRequest) async throws -> RecordingResponse {
        let url = try buildURL("/api/recordings")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        request.httpBody = try JSONEncoder().encode(req)

        return try await perform(request)
    }

    /// List folders for the current user.
    func listFolders() async throws -> [Folder] {
        let url = try buildURL("/api/folders")
        var request = URLRequest(url: url)
        addAuth(&request)

        let response: ItemsResponse<Folder> = try await perform(request)
        return response.items
    }

    /// List tags for the current user.
    func listTags() async throws -> [Tag] {
        let url = try buildURL("/api/tags")
        var request = URLRequest(url: url)
        addAuth(&request)

        let response: ItemsResponse<Tag> = try await perform(request)
        return response.items
    }

    // MARK: - Internal

    private func buildURL(_ path: String) throws -> URL {
        let urlString = "\(baseURL)\(path)"
        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL(urlString)
        }
        return url
    }

    private func addAuth(_ request: inout URLRequest) {
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.networkError(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError("Invalid response")
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            // Try to extract error message from JSON
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMsg = json["error"] as? String {
                throw APIError.httpError(httpResponse.statusCode, errorMsg)
            }
            throw APIError.httpError(httpResponse.statusCode, body)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error.localizedDescription)
        }
    }
}
