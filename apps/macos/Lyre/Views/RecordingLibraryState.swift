import SwiftUI

/// Window navigation must not recreate playback, selection, or an active upload.
@MainActor @Observable
final class RecordingLibraryState {
    let player = AudioPlayerManager()
    private(set) var uploadManager: UploadManager
    var selection: Set<URL> = []
    var search = ""
    var recordingToUpload: RecordingFile?
    /// Retain background progress and results for this app session without taking over a manual draft.
    private(set) var automaticUploads: [URL: UploadManager] = [:]
    private let config: AppConfig
    private let startAutomaticUpload: (UploadManager, RecordingFile) -> Void

    init(
        config: AppConfig,
        startAutomaticUpload: @escaping (UploadManager, RecordingFile) -> Void = { $0.upload(file: $1) }
    ) {
        self.config = config
        self.startAutomaticUpload = startAutomaticUpload
        uploadManager = UploadManager(config: config)
    }

    var isUploading: Bool { uploadManager.state.isInProgress }

    var isShowingAutomaticUpload: Bool {
        guard let recordingToUpload else { return false }
        return automaticUploads[recordingToUpload.url] === uploadManager
    }

    var canLeaveUpload: Bool { !isUploading || isShowingAutomaticUpload }

    /// Called only after a successful stop and metadata refresh, never from a directory scan.
    func uploadAutomaticallyIfNeeded(_ recording: RecordingFile) {
        guard config.autoUploadEnabled,
              let duration = recording.duration, duration.isFinite,
              duration > Double(config.autoUploadMinimumMinutes) * 60,
              automaticUploads[recording.url] == nil,
              recordingToUpload?.url != recording.url else { return }

        // A separate manager keeps other manual uploads and their folder/tag choices intact.
        let manager = UploadManager(config: config)
        manager.title = recording.filename
        automaticUploads[recording.url] = manager
        startAutomaticUpload(manager, recording)
    }

    func visibleRecordings(in recordings: [RecordingFile]) -> [RecordingFile] {
        guard !search.isEmpty else { return recordings }
        return recordings.filter {
            $0.filename.localizedCaseInsensitiveContains(search)
                || $0.createdAt.formatted(date: .long, time: .shortened).localizedCaseInsensitiveContains(search)
        }
    }

    func reconcileSelection(with recordings: [RecordingFile]) {
        let available = Set(recordings.map(\.url))
        selection.formIntersection(available)
        switch player.state {
        case .playing(let url), .paused(let url):
            if !available.contains(url) { player.stop() }
        case .stopped: break
        }
        if selection.isEmpty, let first = visibleRecordings(in: recordings).first {
            selection = [first.url]
        }
    }

    func beginUpload(_ recording: RecordingFile) {
        guard canLeaveUpload else { return }
        closeUpload()
        if let automatic = automaticUploads[recording.url], automatic.state != .idle {
            uploadManager = automatic
        } else {
            automaticUploads[recording.url] = nil
            uploadManager.title = recording.filename
        }
        recordingToUpload = recording
    }

    func closeUpload() {
        if isShowingAutomaticUpload {
            if uploadManager.state == .idle, let recordingToUpload {
                automaticUploads[recordingToUpload.url] = nil
            }
        } else {
            uploadManager.reset()
        }
        // A cancelled request can still finish. Keep its state out of the next upload.
        uploadManager = UploadManager(config: config)
        recordingToUpload = nil
    }

    func isBeingUploaded(_ recording: RecordingFile) -> Bool {
        (isUploading && recordingToUpload?.url == recording.url)
            || automaticUploads[recording.url]?.state.isInProgress == true
    }
}
