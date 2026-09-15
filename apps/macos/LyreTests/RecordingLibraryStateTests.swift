import Foundation
import Testing
@testable import Lyre

@MainActor @Suite("Recording library navigation state")
struct RecordingLibraryStateTests {
    @Test func directoryChangesKeepAnUploadButRetireMissingPlayback() {
        let config = AppConfig(configURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-ui-config-\(UUID()).json"))
        let library = RecordingLibraryState(config: config)
        let old = recording("old")
        let next = recording("new")
        library.selection = [old.url]
        library.player.state = .paused(old.url)
        library.player.currentTime = 12
        library.beginUpload(old)
        library.uploadManager.state = .uploading(progress: 0.1)

        library.reconcileSelection(with: [next])
        #expect(library.selection == [next.url])
        #expect(library.player.state == .stopped)
        #expect(library.recordingToUpload?.url == old.url)
        #expect(library.isUploading)
        #expect(library.hasActiveUploads)
        // A second selection must not replace the upload already owned by the window.
        library.beginUpload(next)
        #expect(library.recordingToUpload?.url == old.url)
    }

    @Test func refreshRetainsSurvivingMultiSelection() {
        let config = AppConfig(configURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-ui-config-\(UUID()).json"))
        let library = RecordingLibraryState(config: config)
        let first = recording("first")
        let second = recording("second")
        let removed = recording("removed")
        library.selection = [first.url, second.url, removed.url]
        library.reconcileSelection(with: [first, second])
        #expect(library.selection == [first.url, second.url])
    }

    @Test func cancelledUploadCannotOverwriteTheNextDraft() {
        let config = AppConfig(configURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-ui-config-\(UUID()).json"))
        let library = RecordingLibraryState(config: config)
        library.beginUpload(recording("first"))
        let previousUpload = library.uploadManager
        previousUpload.state = .uploading(progress: 0.1)
        library.closeUpload()
        library.beginUpload(recording("second"))

        // Simulate a cancelled network request completing after the next draft opens.
        previousUpload.state = .failed("Cancelled")
        #expect(library.uploadManager.state == .idle)
        #expect(library.uploadManager.title == "second")
        #expect(library.recordingToUpload?.filename == "second")
    }

    @Test func automaticUploadRequiresOptInAndStrictlyExceedsConfiguredDuration() {
        let config = makeConfig()
        var uploaded: [RecordingFile] = []
        let library = RecordingLibraryState(config: config, startAutomaticUpload: { _, file in uploaded.append(file) })
        library.uploadAutomaticallyIfNeeded(recording("disabled", duration: 1000))
        #expect(uploaded.isEmpty)

        config.autoUploadEnabled = true
        let excluded: [Double?] = [nil, -.infinity, .infinity, .nan, -1, 0, 299.99, 300]
        for (index, duration) in excluded.enumerated() {
            library.uploadAutomaticallyIfNeeded(recording("excluded-\(index)", duration: duration))
        }
        #expect(uploaded.isEmpty)
        library.uploadAutomaticallyIfNeeded(recording("over-five", duration: 300.001))

        config.autoUploadMinimumMinutes = 10
        library.uploadAutomaticallyIfNeeded(recording("exactly-ten", duration: 600))
        library.uploadAutomaticallyIfNeeded(recording("over-ten", duration: 600.001))
        config.autoUploadEnabled = false
        library.uploadAutomaticallyIfNeeded(recording("disabled-again", duration: 1000))
        #expect(uploaded.map(\.filename) == ["over-five", "over-ten"])
    }

    @Test func automaticUploadsPreserveManualDraftAndDoNotDuplicateFiles() {
        let config = makeConfig()
        config.autoUploadEnabled = true
        var uploaded: [URL] = []
        let library = RecordingLibraryState(config: config, startAutomaticUpload: { manager, file in
            uploaded.append(file.url)
            manager.state = .uploading(progress: 0)
        })
        let draft = recording("manual", duration: 1000)
        let first = recording("automatic-one", duration: 600)
        let second = recording("automatic-two", duration: 700)
        library.selection = [draft.url]
        library.beginUpload(draft)
        let manual = library.uploadManager
        manual.title = "My edited title"
        manual.selectedFolderID = "chosen-folder"
        manual.selectedTagIDs = ["chosen-tag"]
        library.uploadAutomaticallyIfNeeded(first)
        library.uploadAutomaticallyIfNeeded(first)
        // An explicit manual draft takes precedence for that same recording.
        library.uploadAutomaticallyIfNeeded(draft)
        manual.state = .uploading(progress: 0.5)
        library.uploadAutomaticallyIfNeeded(second)

        #expect(uploaded == [first.url, second.url])
        #expect(library.uploadManager === manual)
        #expect(manual.title == "My edited title")
        #expect(manual.selectedFolderID == "chosen-folder")
        #expect(manual.selectedTagIDs == ["chosen-tag"])
        #expect(library.selection == [draft.url])
        #expect(library.automaticUploads[first.url]?.title == first.filename)
        #expect(library.automaticUploads[first.url]?.selectedFolderID == nil)
        #expect(library.automaticUploads[first.url]?.selectedTagIDs.isEmpty == true)
        #expect(library.isBeingUploaded(first))
        #expect(library.isBeingUploaded(second))
        #expect(library.isBeingUploaded(draft))
    }

    @Test func backgroundUploadSurvivesNavigationAndKeepsItsResult() throws {
        let config = makeConfig()
        config.autoUploadEnabled = true
        let library = RecordingLibraryState(config: config, startAutomaticUpload: { manager, _ in
            manager.state = .presigning
        })
        let file = recording("automatic", duration: 600)
        library.uploadAutomaticallyIfNeeded(file)
        let background = try #require(library.automaticUploads[file.url])
        #expect(library.recordingToUpload == nil)
        #expect(library.canLeaveUpload)
        #expect(library.isBeingUploaded(file))

        // Relaunch protection must include uploads that are not the visible draft.
        #expect(!library.isUploading)
        #expect(library.hasActiveUploads)

        library.beginUpload(file)
        #expect(library.uploadManager === background)
        #expect(library.isShowingAutomaticUpload)
        #expect(library.canLeaveUpload)
        library.closeUpload()
        library.reconcileSelection(with: [])
        #expect(background.state == .presigning)
        #expect(library.isBeingUploaded(file))

        background.state = .completed(recordingId: "uploaded-id")
        library.beginUpload(file)
        library.closeUpload()
        #expect(background.state == .completed(recordingId: "uploaded-id"))
        #expect(!library.isBeingUploaded(file))
        #expect(!library.hasActiveUploads)
    }

    @Test func unconfiguredAutomaticUploadHasVisibleRetryableFailure() throws {
        let config = makeConfig()
        config.autoUploadEnabled = true
        let library = RecordingLibraryState(config: config)
        let file = recording("needs-connection", duration: 600)
        library.uploadAutomaticallyIfNeeded(file)
        let failed = try #require(library.automaticUploads[file.url])
        #expect(failed.state == .failed("Server not configured"))
        #expect(!library.isBeingUploaded(file))
        library.beginUpload(file)
        #expect(library.uploadManager === failed)
        #expect(library.isShowingAutomaticUpload)
        library.closeUpload()
        #expect(failed.state == .failed("Server not configured"))
    }

    @Test func cancelledBackgroundRequestCannotOverwriteAManualRetry() throws {
        let config = makeConfig()
        config.autoUploadEnabled = true
        let library = RecordingLibraryState(config: config, startAutomaticUpload: { manager, _ in
            manager.state = .preparing
        })
        let file = recording("cancelled", duration: 600)
        library.uploadAutomaticallyIfNeeded(file)
        let cancelled = try #require(library.automaticUploads[file.url])
        library.beginUpload(file)
        cancelled.cancel()
        library.closeUpload()
        cancelled.state = .failed("Late response after cancellation")
        #expect(library.automaticUploads[file.url] == nil)
        library.beginUpload(file)
        cancelled.state = .failed("Late response")

        #expect(library.uploadManager !== cancelled)
        #expect(library.uploadManager.state == .idle)
        #expect(library.uploadManager.title == file.filename)
        #expect(!library.isShowingAutomaticUpload)
        #expect(library.automaticUploads[file.url] == nil)
    }

    @Test func refreshingTheLibraryDoesNotUploadExistingFiles() {
        let config = makeConfig()
        config.autoUploadEnabled = true
        var uploadCount = 0
        let library = RecordingLibraryState(config: config, startAutomaticUpload: { _, _ in uploadCount += 1 })
        library.reconcileSelection(with: [recording("existing", duration: 1000)])
        #expect(uploadCount == 0)
        #expect(library.automaticUploads.isEmpty)
    }

    private func makeConfig() -> AppConfig {
        AppConfig(configURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-auto-upload-\(UUID()).json"))
    }

    private func recording(_ name: String, duration: TimeInterval? = nil) -> RecordingFile {
        RecordingFile(url: URL(fileURLWithPath: "/demo/\(name).m4a"), fileSize: 1_000,
                      createdAt: Date(), duration: duration)
    }
}
