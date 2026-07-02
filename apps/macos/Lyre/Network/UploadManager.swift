import Foundation
import os

/// Manages the 3-step upload flow: presign → OSS upload → create recording.
///
/// Designed to be used as an `@Observable` state holder for the upload UI.
@MainActor
@Observable
final class UploadManager {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "UploadManager")

    // MARK: - State

    enum UploadState: Equatable {
        case idle
        /// Downmixing / any local preprocessing before we hit the network.
        /// Emitted immediately when the user clicks Upload so the UI has
        /// something to show for the first 0.5–2 s of AVAssetWriter work.
        case preparing
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

        // Flip state BEFORE any await so the UI switches to the
        // progress view on the same click cycle. Downmix is
        // AVAssetWriter work that can take a second or two, and
        // during that window the user was previously staring at
        // the same form with no feedback.
        state = .preparing

        // Step 0: downmix any dual-track source into a single-track M4A
        // suitable for HTML5 <audio>. Falls through to the original file
        // if downmix fails — a dual-track upload is a "no audio in dashboard"
        // bug, but it's still a valid file the user can download.
        let (uploadURL, tempURL) = await prepareUploadFile(originalURL: file.url)
        defer {
            if let temp = tempURL {
                try? FileManager.default.removeItem(at: temp)
            }
        }
        guard !Task.isCancelled else { state = .idle; return }

        // Recompute file size after downmix; re-encoded output has a
        // different byte count than the source, and the server stores
        // this in the recording metadata for display.
        let uploadFileSize: Int64
        if let attrs = try? FileManager.default.attributesOfItem(atPath: uploadURL.path),
           let size = attrs[.size] as? Int64 {
            uploadFileSize = size
        } else {
            uploadFileSize = file.fileSize
        }

        // Step 1: Presign
        guard let presign = await stepPresign(
            client: client, fileName: fileName, contentType: contentType
        ) else { return }
        guard !Task.isCancelled else { state = .idle; return }

        // Step 2: Upload to OSS
        let uploaded = await stepUploadToOSS(
            client: client,
            fileURL: uploadURL,
            fileSize: uploadFileSize,
            presignResponse: presign,
            contentType: contentType
        )
        guard uploaded else { return }
        guard !Task.isCancelled else { state = .idle; return }

        // Step 3: Create recording
        await stepCreateRecording(
            client: client, file: file,
            fileSize: uploadFileSize,
            fileName: fileName, presignResponse: presign
        )
    }

    /// Return the URL the upload step should read from. If the source has
    /// multiple audio tracks, downmix into a temp file; otherwise return
    /// the original URL untouched.
    ///
    /// The second element is the temp file URL when a downmix ran, so the
    /// caller can clean it up in a `defer` — nil when we passed through.
    private func prepareUploadFile(originalURL: URL) async -> (upload: URL, temp: URL?) {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-upload-\(UUID().uuidString).m4a")
        do {
            try await AudioDownmixer.downmix(source: originalURL, destination: temp)
            // AudioDownmixer copies verbatim for single-track sources, so
            // treat the returned temp file as the upload input either way.
            return (temp, temp)
        } catch {
            Self.logger.error("Downmix failed, uploading original: \(error.localizedDescription)")
            try? FileManager.default.removeItem(at: temp)
            return (originalURL, nil)
        }
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
        fileURL: URL,
        fileSize: Int64,
        presignResponse: APIClient.PresignResponse,
        contentType: String
    ) async -> Bool {
        state = .uploading(progress: 0)
        Self.logger.info("Step 2/3: Uploading to OSS (\(fileSize) bytes)")

        do {
            state = .uploading(progress: 0.1)
            try await client.uploadToOSS(
                uploadURL: presignResponse.uploadUrl,
                fileURL: fileURL,
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
        fileSize: Int64,
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
                    fileSize: fileSize,
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
