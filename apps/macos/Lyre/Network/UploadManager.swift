import Foundation
import os

@MainActor
@Observable
final class UploadManager {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "UploadManager")

    enum UploadState: Equatable {
        case idle
        case preparing
        case transcribing
        case presigning
        case uploading(progress: Double)
        case creating
        case completed(recordingId: String)
        case failed(String)

        var isInProgress: Bool {
            switch self {
            case .preparing, .transcribing, .presigning, .uploading, .creating: true
            case .idle, .completed, .failed: false
            }
        }
    }

    var state: UploadState = .idle
    var localSTTWarning: String?
    var folders: [APIClient.Folder] = []
    var tags: [APIClient.Tag] = []
    var isFetchingMetadata = false
    var metadataError: String?
    var selectedFolderID: String?
    var selectedTagIDs: Set<String> = []
    var title = ""

    private let config: AppConfig
    private let session: URLSession
    private let transcribe: @Sendable (URL, Double?, LocalSTTSettings) async throws -> LocalTranscription
    private let downmix: @Sendable (URL, URL) async throws -> Void
    private var currentTask: Task<Void, Never>?

    init(
        config: AppConfig, session: URLSession = .shared,
        transcribe: @escaping @Sendable (URL, Double?, LocalSTTSettings) async throws -> LocalTranscription = {
            try await LocalSTT.transcribe(source: $0, duration: $1, settings: $2)
        },
        downmix: @escaping @Sendable (URL, URL) async throws -> Void = {
            try await AudioDownmixer.downmix(source: $0, destination: $1)
        }
    ) {
        self.config = config
        self.session = session
        self.transcribe = transcribe
        self.downmix = downmix
    }

    func upload(file: RecordingFile) {
        guard !state.isInProgress else { return }
        guard config.isServerConfigured else {
            state = .failed("Server not configured")
            return
        }
        currentTask?.cancel()
        localSTTWarning = nil
        state = .preparing
        currentTask = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await self.performUpload(file: file)
        }
    }

    func cancel() {
        currentTask?.cancel()
        currentTask = nil
        state = .idle
    }

    func reset() {
        cancel()
        title = ""
        selectedFolderID = nil
        selectedTagIDs = []
        metadataError = nil
        localSTTWarning = nil
    }

    private func performUpload(file: RecordingFile) async {
        let client = makeClient()
        let settings = config.localSTT
        let serverURL = config.serverURL
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("lyre-upload-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: temp) }
        do {
            let transcript = try await prepareTranscription(file: file, settings: settings)
            try Task.checkCancellation()
            state = .preparing
            try await downmix(file.url, temp)
            try Task.checkCancellation()
            let directory = try LocalSTT.artifactDirectory(source: file.url, serverURL: serverURL)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let identity = directory.appendingPathComponent("upload-id.txt")
            let previousID = try? String(contentsOf: identity, encoding: .utf8)
            state = .presigning
            let presign = try await client.presign(fileName: file.url.lastPathComponent,
                                                   contentType: Constants.Audio.mimeType, recordingId: previousID)
            try presign.recordingId.write(to: identity, atomically: true, encoding: .utf8)
            try Task.checkCancellation()
            state = .uploading(progress: 0)
            try await client.uploadToOSS(uploadURL: presign.uploadUrl, fileURL: temp,
                                         contentType: Constants.Audio.mimeType)
            try Task.checkCancellation()
            state = .creating
            let response = try await client.createRecording(makeRequest(file: file, upload: temp,
                                                                         presign: presign, transcript: transcript))
            try Task.checkCancellation()
            state = .completed(recordingId: response.id)
        } catch {
            guard !Task.isCancelled else { return }
            if error is CancellationError { state = .idle; return }
            state = .failed(error.localizedDescription)
        }
    }

    private func prepareTranscription(
        file: RecordingFile, settings: LocalSTTSettings
    ) async throws -> LocalTranscription? {
        guard settings.enabled else { return nil }
        state = .transcribing
        do {
            let result = try await transcribe(file.url, file.duration, settings)
            try Task.checkCancellation()
            return result
        } catch {
            try Task.checkCancellation()
            if error is CancellationError { throw error }
            localSTTWarning = "Local transcription failed. Lyre will transcribe on the server. "
                + error.localizedDescription
            Self.logger.warning("Local STT failed: \(error.localizedDescription)")
            return nil
        }
    }

    private func makeRequest(
        file: RecordingFile, upload: URL, presign: APIClient.PresignResponse, transcript: LocalTranscription?
    ) -> APIClient.CreateRecordingRequest {
        let attributes = try? FileManager.default.attributesOfItem(atPath: upload.path)
        return APIClient.CreateRecordingRequest(
            id: presign.recordingId, title: title.isEmpty ? file.filename : title,
            fileName: file.url.lastPathComponent, ossKey: presign.ossKey,
            fileSize: attributes?[.size] as? Int64 ?? file.fileSize,
            duration: file.duration, format: Constants.Audio.fileExtension,
            sampleRate: Constants.Audio.sampleRateInt,
            tags: selectedTagIDs.isEmpty ? nil : Array(selectedTagIDs), folderId: selectedFolderID,
            recordedAt: Int64(file.createdAt.timeIntervalSince1970 * 1000),
            localTranscription: transcript, autoTranscribe: true
        )
    }

    private func makeClient() -> APIClient {
        APIClient(baseURL: config.serverURL, authToken: config.authToken, session: session)
    }
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

}
