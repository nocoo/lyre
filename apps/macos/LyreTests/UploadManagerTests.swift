import Testing
import Foundation
@testable import Lyre

@Suite("UploadManager Tests")
struct UploadManagerTests {

    // MARK: - Helpers

    private func makeConfig(
        serverURL: String = "https://lyre.test",
        authToken: String = "test-token"
    ) -> AppConfig {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-upload-test-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let config = AppConfig(configURL: configURL)
        config.serverURL = serverURL
        config.authToken = authToken
        return config
    }

    private func makeDummyRecording() -> RecordingFile {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-upload-test-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let url = tempDir.appendingPathComponent("test-recording.m4a")
        try! Data(repeating: 0xAB, count: 2048).write(to: url)
        return RecordingFile(
            url: url,
            fileSize: 2048,
            createdAt: Date(),
            duration: 30.0
        )
    }

    // MARK: - Init

    @Test func initialStateIsIdle() {
        let config = makeConfig()
        let manager = UploadManager(config: config)
        #expect(manager.state == .idle)
        #expect(manager.title == "")
        #expect(manager.selectedFolderID == nil)
        #expect(manager.selectedTagIDs.isEmpty)
        #expect(manager.folders.isEmpty)
        #expect(manager.tags.isEmpty)
        #expect(!manager.isFetchingMetadata)
    }

    // MARK: - Upload without config

    @Test func uploadFailsWithoutServerConfig() {
        let config = makeConfig(serverURL: "", authToken: "")
        let manager = UploadManager(config: config)
        let recording = makeDummyRecording()

        manager.upload(file: recording)

        #expect(manager.state == .failed("Server not configured"))
    }

    // MARK: - Reset

    @Test func resetClearsState() {
        let config = makeConfig()
        let manager = UploadManager(config: config)

        manager.title = "Test Title"
        manager.selectedFolderID = "folder1"
        manager.selectedTagIDs = ["tag1", "tag2"]

        manager.reset()

        #expect(manager.state == .idle)
        #expect(manager.title == "")
        #expect(manager.selectedFolderID == nil)
        #expect(manager.selectedTagIDs.isEmpty)
    }

    // MARK: - Cancel

    @Test func cancelResetsToIdle() {
        let config = makeConfig()
        let manager = UploadManager(config: config)

        // Simulate being in-progress
        manager.cancel()

        #expect(manager.state == .idle)
    }

    // MARK: - fetchMetadata without config

    @Test func fetchMetadataSkipsWithoutConfig() async {
        let config = makeConfig(serverURL: "", authToken: "")
        let manager = UploadManager(config: config)

        await manager.fetchMetadata()

        #expect(manager.folders.isEmpty)
        #expect(manager.tags.isEmpty)
        #expect(!manager.isFetchingMetadata)
    }

    // MARK: - UploadState equatable

    @Test func uploadStateEquality() {
        #expect(UploadManager.UploadState.idle == .idle)
        #expect(UploadManager.UploadState.presigning == .presigning)
        #expect(UploadManager.UploadState.creating == .creating)
        #expect(UploadManager.UploadState.uploading(progress: 0.5) == .uploading(progress: 0.5))
        #expect(UploadManager.UploadState.uploading(progress: 0.5) != .uploading(progress: 0.8))
        #expect(UploadManager.UploadState.completed(recordingId: "abc") == .completed(recordingId: "abc"))
        #expect(UploadManager.UploadState.completed(recordingId: "abc") != .completed(recordingId: "xyz"))
        #expect(UploadManager.UploadState.failed("err") == .failed("err"))
        #expect(UploadManager.UploadState.idle != .presigning)
    }
}
