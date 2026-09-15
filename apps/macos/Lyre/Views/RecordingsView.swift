import SwiftUI

struct RecordingsView: View {
    @Bindable var store: RecordingsStore
    @Bindable var config: AppConfig
    @Bindable var library: RecordingLibraryState
    var isRecording = false
    var isRequestingRecording = false
    let onRecord: () -> Void
    let onOpenSettings: () -> Void
    @Environment(\.lyrePreview) private var isPreview
    @FocusState private var searchFocused: Bool
    @State private var pendingDeletion: [RecordingFile] = []
    @State private var showDeleteConfirm = false
    @State private var deleteError: String?

    private var visible: [RecordingFile] { library.visibleRecordings(in: store.recordings) }
    private var selected: [RecordingFile] { store.recordings.filter { library.selection.contains($0.url) } }
    private var groups: [(date: Date, recordings: [RecordingFile])] {
        Dictionary(grouping: visible, by: { Calendar.current.startOfDay(for: $0.createdAt) })
            .map { (date: $0.key, recordings: $0.value) }
            .sorted { $0.date > $1.date }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .focusedSceneValue(\.lyreSearch, { searchFocused = true })
        .onChange(of: library.search) { _, _ in
            guard library.canLeaveUpload else { return }
            let matches = Set(visible.map(\.url))
            library.selection.formIntersection(matches)
            if library.selection.isEmpty, let first = visible.first { library.selection = [first.url] }
        }
        .onChange(of: library.selection) { _, selection in
            if let upload = library.recordingToUpload, selection != [upload.url], library.canLeaveUpload {
                library.closeUpload()
            }
        }
        .sheet(isPresented: Binding(
            get: { showDeleteConfirm || deleteError != nil },
            set: { if !$0 { dismissDialog() } }
        )) {
            if let deleteError {
                LyreDialogView(
                    title: "Couldn’t delete recording", message: deleteError,
                    symbol: "exclamationmark.octagon.fill", eyebrow: "YOUR LIBRARY", tone: .error,
                    primary: "Close", primarySymbol: "xmark", onPrimary: dismissDialog
                )
            } else {
                LyreDialogView(
                    title: pendingDeletion.count == 1 ? "Delete this recording?" : "Delete these recordings?",
                    message: "The original \(pendingDeletion.count == 1 ? "file" : "files") "
                        + "will be permanently removed from this Mac. This can’t be undone.",
                    symbol: "trash", eyebrow: "YOUR LIBRARY", tone: .destructive,
                    detail: pendingDeletion.count == 1 ? pendingDeletion.first?.url.lastPathComponent
                        : "\(pendingDeletion.count) recordings selected",
                    primary: "Delete", primarySymbol: "trash", secondary: "Cancel",
                    onPrimary: deletePending, onSecondary: dismissDialog
                )
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 20) {
            LyrePageHeading(
                title: "Recordings",
                subtitle: store.hasLoaded
                    ? "\(store.recordings.count) recordings, saved on this Mac."
                    : "Your audio, close at hand."
            )
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search recordings", text: $library.search)
                    .textFieldStyle(.plain)
                    .focused($searchFocused)
                    .accessibilityLabel("Search recordings")
                if !library.search.isEmpty {
                    Button("Clear search", systemImage: "xmark.circle.fill") { library.search = "" }
                        .labelStyle(.iconOnly).buttonStyle(.plain).foregroundStyle(.secondary)
                }
            }
            .font(.system(size: 12))
            .padding(.horizontal, 11)
            .frame(width: 204, height: LyreTheme.controlHeight)
            .background(LyreTheme.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(LyreTheme.separator, lineWidth: 1) }
            .help("Search recordings (⌘F)")
            if library.selection.count > 1 {
                Button("Delete selected recordings", systemImage: "trash") { confirmDeletion(selected) }
                    .labelStyle(.iconOnly).buttonStyle(LyreButtonStyle(iconOnly: true))
                    .disabled(selected.contains { library.isBeingUploaded($0) })
            }
        }
        .padding(LyreTheme.pageInset)
    }

    @ViewBuilder private var content: some View {
        if !store.hasLoaded {
            ProgressView("Loading recordings…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.recordings.isEmpty && library.recordingToUpload == nil {
            emptyLibrary
        } else if visible.isEmpty && library.recordingToUpload == nil {
            ContentUnavailableView {
                Label("No recordings found", systemImage: "magnifyingglass")
            } description: {
                Text("Try another filename or date, or clear your search to see all recordings.")
            } actions: {
                Button("Clear", systemImage: "xmark.circle") { library.search = "" }
                    .buttonStyle(LyreButtonStyle()).help("Clear the recording search")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            HStack(spacing: 0) {
                recordingList.frame(width: 256)
                Divider()
                detail.frame(minWidth: 380, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var recordingList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("YOUR LIBRARY").font(.system(size: 10, weight: .semibold)).tracking(0.8)
                Spacer()
                Text("Newest first").font(.system(size: 10))
            }
            .foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 18)

            List(selection: $library.selection) {
                ForEach(groups, id: \.date) { group in
                    Section(groupTitle(group.date)) {
                        ForEach(group.recordings) { recording in
                            RecordingRow(recording: recording, player: library.player,
                                         automaticUploadState: library.automaticUploads[recording.url]?.state)
                                .tag(recording.url)
                                .listRowSeparator(.hidden)
                                .contextMenu { recordingMenu(recording) }
                        }
                    }
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .disabled(!library.canLeaveUpload)
            .onDeleteCommand { confirmDeletion(selected) }
            .overlay {
                if visible.isEmpty {
                    if library.search.isEmpty {
                        Text("No recordings in this folder.")
                            .font(.system(size: 12)).foregroundStyle(.secondary).padding(20)
                    } else {
                        ContentUnavailableView.search(text: library.search)
                    }
                }
            }
            Text("\(visible.count) \(visible.count == 1 ? "recording" : "recordings")")
                .font(.system(size: 11)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }
        .background(LyreTheme.surface.opacity(0.45))
    }

    @ViewBuilder private var detail: some View {
        if let recording = library.recordingToUpload {
            UploadView(uploadManager: library.uploadManager, recording: recording, config: config,
                       isAutomatic: library.isShowingAutomaticUpload) {
                library.closeUpload()
            }
            .id(recording.url)
        } else if selected.count > 1 {
            ContentUnavailableView {
                Label("\(selected.count) recordings selected", systemImage: "square.stack")
            } description: {
                Text("Select one recording to listen, or delete the selected files.")
            } actions: {
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDeletion(selected) }
                    .buttonStyle(LyreButtonStyle())
                    .help("Delete the selected recordings")
            }
        } else if let recording = selected.first {
            RecordingDetailView(
                recording: recording,
                player: library.player,
                isServerConfigured: config.isServerConfigured,
                automaticUploadState: library.automaticUploads[recording.url]?.state,
                onUpload: { library.beginUpload(recording) },
                onDelete: { confirmDeletion([recording]) },
                onOpenSettings: onOpenSettings
            )
            .id(recording.url)
        } else {
            ContentUnavailableView("Select a recording", systemImage: "waveform",
                                   description: Text("Choose a file from your library to listen."))
        }
    }

    private var emptyLibrary: some View {
        VStack(spacing: 18) {
            LyreBrandMark(size: 92)
            Text(isRecording ? "Recording in progress." : "Your first recording starts here.")
                .font(.system(size: 25, weight: .semibold))
            Text(isRecording
                 ? "Your recording will appear here after you stop."
                 : "Capture system audio and your microphone together.\n"
                   + "Save locally, then upload when you choose — or enable automatic uploads in Settings.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).lineSpacing(5)
            LyreRecordingButton(isRecording: isRecording, isBusy: isRequestingRecording, action: onRecord)
                .padding(.top, 6)
        }
        .padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private func recordingMenu(_ recording: RecordingFile) -> some View {
        Button(library.player.isPlaying(recording.url) ? "Pause" : "Play",
               systemImage: library.player.isPlaying(recording.url) ? "pause.fill" : "play.fill") {
            library.selection = [recording.url]
            if isPreview {
                if !library.player.isActive(recording.url) { library.player.currentTime = 0 }
                library.player.duration = recording.duration ?? 0
                library.player.state = library.player.isPlaying(recording.url)
                    ? .paused(recording.url) : .playing(recording.url)
            } else {
                library.player.toggle(recording.url)
            }
        }
        Button("Upload", systemImage: "arrow.up.doc") {
            library.selection = [recording.url]
            library.beginUpload(recording)
        }
        .disabled((!config.isServerConfigured && library.automaticUploads[recording.url] == nil)
                  || !library.canLeaveUpload)
        .help("Upload this recording to Lyre")
        Button("Reveal", systemImage: "folder") {
            if !isPreview { NSWorkspace.shared.activateFileViewerSelecting([recording.url]) }
        }
        .help("Show this recording in Finder")
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { confirmDeletion([recording]) }
            .disabled(library.isBeingUploaded(recording))
    }

    private func groupTitle(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.month(.wide).day())
    }

    private func confirmDeletion(_ recordings: [RecordingFile]) {
        guard !recordings.isEmpty, !recordings.contains(where: { library.isBeingUploaded($0) }) else { return }
        pendingDeletion = recordings
        showDeleteConfirm = true
    }

    private func deletePending() {
        showDeleteConfirm = false
        guard !pendingDeletion.contains(where: { library.isBeingUploaded($0) }) else {
            pendingDeletion = []
            deleteError = "An upload has started. Cancel it or wait for it to finish before deleting the recording."
            return
        }
        defer {
            pendingDeletion = []
            library.reconcileSelection(with: store.recordings)
        }
        for recording in pendingDeletion where library.player.isActive(recording.url) {
            library.player.stop()
        }
        do {
            if isPreview {
                let deleted = Set(pendingDeletion.map(\.url))
                store.recordings.removeAll { deleted.contains($0.url) }
            } else {
                try store.delete(pendingDeletion)
            }
        } catch {
            deleteError = error.localizedDescription
        }
    }

    private func dismissDialog() {
        showDeleteConfirm = false
        deleteError = nil
        pendingDeletion = []
    }
}

struct RecordingRow: View {
    let recording: RecordingFile
    @Bindable var player: AudioPlayerManager
    var automaticUploadState: UploadManager.UploadState?

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: player.isPlaying(recording.url) ? "speaker.wave.2.fill" : "waveform")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(player.isActive(recording.url) ? LyreTheme.accent : .secondary)
                .frame(width: 34, height: 38)
                .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 6) {
                Text(recording.libraryTitle)
                    .font(.system(size: 13, weight: .medium)).lineLimit(1).truncationMode(.middle)
                Text("\(recording.formattedDuration)  ·  \(recording.formattedSize)")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            automaticUploadStatus
        }
        .padding(.vertical, 8)
        .help(recording.url.lastPathComponent)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var automaticUploadStatus: some View {
        switch automaticUploadState {
        case .preparing, .presigning, .uploading, .creating:
            ProgressView().controlSize(.mini).frame(width: 14, height: 14)
                .help("Uploading automatically").accessibilityLabel("Uploading automatically")
        case .completed:
            Image(systemName: "checkmark.icloud").foregroundStyle(LyreTheme.success)
                .help("Uploaded to Lyre").accessibilityLabel("Uploaded to Lyre")
        case .failed:
            Image(systemName: "exclamationmark.icloud").foregroundStyle(LyreTheme.error)
                .help("Automatic upload failed. Open the recording to retry.")
                .accessibilityLabel("Automatic upload failed")
        case .idle, nil: EmptyView()
        }
    }
}

extension RecordingFile {
    private var hasGeneratedName: Bool {
        filename.range(
            of: #"^Recording \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}$"#,
            options: .regularExpression
        ) != nil
    }

    var libraryTitle: String {
        hasGeneratedName ? createdAt.formatted(date: .omitted, time: .shortened) : filename
    }

    var detailTitle: String {
        hasGeneratedName ? createdAt.formatted(.dateTime.month(.wide).day().hour().minute()) : filename
    }
}

private struct LyreSearchKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    var lyreSearch: (() -> Void)? {
        get { self[LyreSearchKey.self] }
        set { self[LyreSearchKey.self] = newValue }
    }
}
