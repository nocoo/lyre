import SwiftUI

/// List of local recordings with playback and delete controls.
struct RecordingsView: View {
    @Bindable var store: RecordingsStore
    @Bindable var config: AppConfig
    @State private var player = AudioPlayerManager()
    @State private var showDeleteConfirm = false
    @State private var recordingToDelete: RecordingFile?
    @State private var recordingToUpload: RecordingFile?
    @State private var uploadManager: UploadManager?
    @State private var deleteError: String?

    var body: some View {
        VStack(spacing: 0) {
            if store.isScanning {
                ProgressView("Scanning recordings...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.recordings.isEmpty {
                emptyState
            } else {
                recordingsList
            }
        }
        .frame(minWidth: 400, minHeight: 300)
        .onAppear {
            Task { await store.scan() }
        }
        .onDisappear {
            player.stop()
        }
        .alert("Delete Recording", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) {
                if let recording = recordingToDelete {
                    do {
                        try store.delete(recording)
                        if player.isActive(recording.url) {
                            player.stop()
                        }
                    } catch {
                        deleteError = error.localizedDescription
                    }
                }
                recordingToDelete = nil
            }
            Button("Cancel", role: .cancel) {
                recordingToDelete = nil
            }
        } message: {
            if let recording = recordingToDelete {
                Text("Are you sure you want to delete \"\(recording.filename)\"? This cannot be undone.")
            }
        }
        .alert("Delete Failed", isPresented: .init(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK") { deleteError = nil }
        } message: {
            if let error = deleteError {
                Text(error)
            }
        }
        .sheet(item: $recordingToUpload) { recording in
            if let manager = uploadManager {
                UploadView(
                    uploadManager: manager,
                    recording: recording,
                    onDismiss: {
                        recordingToUpload = nil
                        uploadManager?.reset()
                    }
                )
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "waveform.circle")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No Recordings")
                .font(.title2)
                .fontWeight(.medium)
            Text("Start a recording from the menu bar to see it here.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Recordings List

    private var recordingsList: some View {
        List {
            ForEach(store.recordings) { recording in
                RecordingRow(
                    recording: recording,
                    player: player,
                    showUpload: config.isServerConfigured,
                    onUpload: {
                        uploadManager = UploadManager(config: config)
                        recordingToUpload = recording
                    },
                    onDelete: {
                        recordingToDelete = recording
                        showDeleteConfirm = true
                    },
                    onReveal: {
                        NSWorkspace.shared.activateFileViewerSelecting([recording.url])
                    }
                )
            }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
    }
}

/// A single recording row with play/pause, metadata, and actions.
struct RecordingRow: View {
    let recording: RecordingFile
    @Bindable var player: AudioPlayerManager
    var showUpload: Bool = false
    var onUpload: (() -> Void)?
    var onDelete: () -> Void
    var onReveal: () -> Void

    private var isPlaying: Bool {
        player.isPlaying(recording.url)
    }

    private var isActive: Bool {
        player.isActive(recording.url)
    }

    var body: some View {
        HStack(spacing: 12) {
            // Play/Pause button
            Button {
                player.toggle(recording.url)
            } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(isPlaying ? .orange : .accentColor)
            }
            .buttonStyle(.plain)

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(recording.filename)
                    .fontWeight(.medium)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Label(recording.formattedDuration, systemImage: "clock")
                    Label(recording.formattedSize, systemImage: "doc")
                    Text(recording.createdAt.formatted(date: .abbreviated, time: .shortened))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()

            // Playback progress (when active)
            if isActive {
                Text(formatTime(player.currentTime))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            // Actions
            Menu {
                if showUpload, let onUpload {
                    Button("Upload to Server") { onUpload() }
                    Divider()
                }
                Button("Show in Finder") { onReveal() }
                Divider()
                Button("Delete", role: .destructive) { onDelete() }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .frame(width: 24)
        }
        .padding(.vertical, 4)
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let mins = Int(time) / 60
        let secs = Int(time) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
