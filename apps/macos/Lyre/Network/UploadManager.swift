import Foundation
import os

/// Manages the 3-step upload flow: presign → OSS upload → create recording.
///
/// Designed to be used as an `@Observable` state holder for the upload UI.
@Observable
final class UploadManager: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "UploadManager")

    // MARK: - State

    enum UploadState: Equatable {
        case idle
        case presigning
        case uploading(progress: Double)
        case creating
        case completed(recordingId: String)
        case failed(String)
    }

    internal(set) var state: UploadState = .idle

    /// Folders and tags fetched from the server.
    internal(set) var folders: [APIClient.Folder] = []
    internal(set) var tags: [APIClient.Tag] = []
    internal(set) var isFetchingMetadata: Bool = false

    /// Error message from the last metadata fetch attempt (nil if succeeded or not attempted).
    internal(set) var metadataError: String?

    // MARK: - Upload parameters (set by UI)

    var selectedFolderID: String?
    var selectedTagIDs: Set<String> = []
    var title: String = ""

    // MARK: - Dependencies

    private let config: AppConfig
    private var currentTask: Task<Void, Never>?

    init(config: AppConfig) {
        self.config = config
    }

    // MARK: - Metadata Fetching

    /// Fetch folders and tags from the server in parallel.
    func fetchMetadata() async {
        guard config.isServerConfigured else { return }

        isFetchingMetadata = true
        metadataError = nil
        defer { isFetchingMetadata = false }

        let client = makeClient()

        async let fetchedFolders = client.listFolders()
        async let fetchedTags = client.listTags()

        do {
            let (f, t) = try await (fetchedFolders, fetchedTags)
            folders = f
            tags = t
            Self.logger.info("Fetched \(f.count) folders, \(t.count) tags")
        } catch let error as APIClient.APIError {
            Self.logger.warning("Failed to fetch metadata: \(error.localizedDescription)")
            switch error {
            case .httpError(401, _):
                metadataError = "Invalid auth token. Check your token in Settings."
            case .httpError(let code, let message):
                metadataError = "Server error (HTTP \(code)): \(message)"
            case .networkError(let detail):
                metadataError = "Network error: \(detail)"
            default:
                metadataError = error.localizedDescription
            }
        } catch {
            Self.logger.warning("Failed to fetch metadata: \(error.localizedDescription)")
            metadataError = "Failed to load folders & tags: \(error.localizedDescription)"
        }
    }

    // MARK: - Upload

    /// Upload a local recording file to the server.
    ///
    /// The 3-step flow:
    /// 1. POST /api/upload/presign → get upload URL + ossKey
    /// 2. PUT <uploadUrl> → upload raw file to OSS
    /// 3. POST /api/recordings → create recording in database
    func upload(file: RecordingFile) {
        guard config.isServerConfigured else {
            state = .failed("Server not configured")
            return
        }

        // Cancel any in-progress upload
        currentTask?.cancel()

        currentTask = Task { [weak self] in
            guard let self else { return }
            await self.performUpload(file: file)
        }
    }

    /// Cancel the current upload.
    func cancel() {
        currentTask?.cancel()
        currentTask = nil
        state = .idle
    }

    /// Reset to idle state.
    func reset() {
        cancel()
        title = ""
        selectedFolderID = nil
        selectedTagIDs = []
        metadataError = nil
    }

    // MARK: - Private

    private func performUpload(file: RecordingFile) async {
        let client = makeClient()
        let fileName = file.url.lastPathComponent
        let contentType = Constants.Audio.mimeType

        // Step 1: Presign
        guard let presign = await stepPresign(
            client: client, fileName: fileName, contentType: contentType
        ) else { return }
        guard !Task.isCancelled else { state = .idle; return }

        // Step 2: Upload to OSS
        let uploaded = await stepUploadToOSS(
            client: client, file: file,
            presignResponse: presign, contentType: contentType
        )
        guard uploaded else { return }
        guard !Task.isCancelled else { state = .idle; return }

        // Step 3: Create recording
        await stepCreateRecording(
            client: client, file: file,
            fileName: fileName, presignResponse: presign
        )
    }

    private func stepPresign(
        client: APIClient, fileName: String, contentType: String
    ) async -> APIClient.PresignResponse? {
        state = .presigning
        Self.logger.info("Step 1/3: Presigning for \(fileName)")

        do {
            return try await client.presign(fileName: fileName, contentType: contentType)
        } catch {
            state = .failed("Presign failed: \(error.localizedDescription)")
            return nil
        }
    }

    private func stepUploadToOSS(
        client: APIClient,
        file: RecordingFile,
        presignResponse: APIClient.PresignResponse,
        contentType: String
    ) async -> Bool {
        state = .uploading(progress: 0)
        Self.logger.info("Step 2/3: Uploading to OSS (\(file.fileSize) bytes)")

        do {
            state = .uploading(progress: 0.1)
            try await client.uploadToOSS(
                uploadURL: presignResponse.uploadUrl,
                fileURL: file.url,
                contentType: contentType
            )
            state = .uploading(progress: 0.9)
            return true
        } catch {
            state = .failed("Upload failed: \(error.localizedDescription)")
            return false
        }
    }

    private func stepCreateRecording(
        client: APIClient,
        file: RecordingFile,
        fileName: String,
        presignResponse: APIClient.PresignResponse
    ) async {
        state = .creating
        Self.logger.info("Step 3/3: Creating recording")

        let recordingTitle = title.isEmpty ? file.filename : title

        do {
            let response = try await client.createRecording(
                APIClient.CreateRecordingRequest(
                    id: presignResponse.recordingId,
                    title: recordingTitle,
                    fileName: fileName,
                    ossKey: presignResponse.ossKey,
                    fileSize: file.fileSize,
                    duration: file.duration,
                    format: Constants.Audio.fileExtension,
                    sampleRate: Constants.Audio.sampleRateInt,
                    tags: selectedTagIDs.isEmpty ? nil : Array(selectedTagIDs),
                    folderId: selectedFolderID,
                    recordedAt: Int64(file.createdAt.timeIntervalSince1970 * 1000)
                )
            )
            state = .completed(recordingId: response.id)
            Self.logger.info("Upload completed: \(response.id)")
        } catch {
            state = .failed("Create recording failed: \(error.localizedDescription)")
        }
    }

    private func makeClient() -> APIClient {
        APIClient(baseURL: config.serverURL, authToken: config.authToken)
    }
}
