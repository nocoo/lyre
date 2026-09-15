import SwiftUI

struct RecordingDetailView: View {
    let recording: RecordingFile
    @Bindable var player: AudioPlayerManager
    let isServerConfigured: Bool
    var automaticUploadState: UploadManager.UploadState?
    let onUpload: () -> Void
    let onDelete: () -> Void
    let onOpenSettings: () -> Void
    @Environment(\.lyrePreview) private var isPreview
    @Environment(\.lyrePreviewWaveform) private var previewWaveform
    @State private var waveform: [Float]?
    @State private var waveformFailed = false
    @State private var scrubTime: Double?

    private var isActive: Bool { player.isActive(recording.url) }
    private var duration: Double { isActive && player.duration > 0 ? player.duration : recording.duration ?? 0 }
    private var currentTime: Double { scrubTime ?? (isActive ? player.currentTime : 0) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                heading
                playback
                metadata
            }
            .padding(24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { uploadAction }
        .task(id: recording.url) {
            if isPreview {
                waveform = previewWaveform
                return
            }
            player.prepare(recording.url)
            do {
                let peaks = try await AudioWaveform.load(url: recording.url)
                if !Task.isCancelled { waveform = peaks }
            } catch {
                if !Task.isCancelled { waveformFailed = true }
            }
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("LOCAL RECORDING").font(.system(size: 10, weight: .semibold))
                    .tracking(0.9).foregroundStyle(.secondary)
                Spacer()
                Menu {
                    Button("Reveal", systemImage: "folder") { reveal() }
                        .help("Show this recording in Finder")
                    Divider()
                    Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
                        .disabled(automaticUploadState?.isInProgress == true)
                } label: {
                    Image(systemName: "ellipsis").frame(width: 32, height: 32)
                }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .help("Recording actions")
            }
            Text(recording.detailTitle).font(.system(size: 22, weight: .semibold))
                .lineLimit(2).textSelection(.enabled)
            Text(recording.url.lastPathComponent).font(.system(size: 11))
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
    }

    private var playback: some View {
        LyreCard(padding: 18) {
            VStack(spacing: 10) {
                waveformView.frame(height: 68)
                Slider(value: Binding(
                    get: { min(currentTime, max(duration, 0.01)) },
                    set: { scrubTime = $0 }
                ), in: 0...max(duration, 0.01)) { editing in
                    if !editing, let target = scrubTime {
                        seek(to: target)
                        scrubTime = nil
                    }
                }
                .disabled(!isActive || player.duration <= 0)
                .accessibilityLabel("Playback position")
                .accessibilityValue("\(formattedTime(currentTime)) of \(formattedTime(duration))")
                HStack {
                    Text(formattedTime(currentTime)).foregroundStyle(LyreTheme.accent)
                    Spacer()
                    Text(recording.formattedDuration).foregroundStyle(.secondary)
                }
                .font(.system(size: 11, design: .monospaced)).padding(.top, -7)
                HStack(spacing: 25) {
                    Button("Back 15 seconds", systemImage: "gobackward.15") { seek(to: currentTime - 15) }
                        .labelStyle(.iconOnly).font(.system(size: 20))
                        .buttonStyle(.borderless).disabled(!isActive || player.duration <= 0)
                    Button(action: togglePlayback) {
                        Image(systemName: player.isPlaying(recording.url) ? "pause.fill" : "play.fill")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(LyreTheme.surface)
                            .frame(width: 50, height: 50)
                            .background(LyreTheme.accent, in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.space, modifiers: [])
                    .accessibilityLabel(player.isPlaying(recording.url) ? "Pause" : "Play")
                    .help("Play or pause (Space)")
                    Button("Forward 15 seconds", systemImage: "goforward.15") { seek(to: currentTime + 15) }
                        .labelStyle(.iconOnly).font(.system(size: 20))
                        .buttonStyle(.borderless).disabled(!isActive || player.duration <= 0)
                }
                .padding(.top, 6)
            }
        }
    }

    @ViewBuilder private var waveformView: some View {
        if let waveform {
            RecordingWaveform(peaks: waveform, progress: duration > 0 ? currentTime / duration : 0)
        } else {
            VStack(spacing: 10) {
                Rectangle().fill(LyreTheme.separator).frame(height: 1)
                if waveformFailed {
                    LyreStatusLabel(title: "Waveform unavailable", symbol: "exclamationmark.triangle.fill",
                                    color: LyreTheme.warning)
                        .font(.system(size: 11))
                } else {
                    ProgressView("Reading audio…").controlSize(.small).font(.system(size: 11))
                }
            }
        }
    }

    private var metadata: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 30) {
                metadataValue("Duration", recording.formattedDuration)
                metadataValue("File size", recording.formattedSize)
                metadataValue("Format", "M4A audio")
                Spacer(minLength: 0)
            }
            Text(recording.createdAt.formatted(date: .complete, time: .shortened))
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Button(action: reveal) {
                Label(recording.url.deletingLastPathComponent().abbreviatingWithTildeInPath, systemImage: "folder")
                    .font(.system(size: 11)).lineLimit(1).truncationMode(.middle)
            }
            .buttonStyle(.plain).foregroundStyle(.secondary)
            .help("Show this recording in Finder")
        }
        .padding(.horizontal, 2)
    }

    private var uploadAction: some View {
        HStack(spacing: 12) {
            Image(systemName: uploadStatusSymbol).font(.system(size: 22, weight: .light))
                .foregroundStyle(uploadStatusColor)
            VStack(alignment: .leading, spacing: 5) {
                Text(uploadHeading).font(.system(size: 13, weight: .semibold))
                Text(uploadDescription)
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button(hasAutomaticUpload ? "View" : isServerConfigured ? "Upload" : "Connect",
                   systemImage: hasAutomaticUpload ? "arrow.right" : isServerConfigured ? "arrow.up.doc" : "link",
                   action: hasAutomaticUpload || isServerConfigured ? onUpload : onOpenSettings)
                .buttonStyle(LyreButtonStyle())
                .help(hasAutomaticUpload ? "View the automatic upload"
                      : isServerConfigured ? "Upload this recording to Lyre" : "Configure the Lyre connection")
        }
        .padding(.horizontal, 24).padding(.vertical, 18)
        .background(LyreTheme.canvas)
        .overlay(alignment: .top) { LyreTheme.separator.frame(height: 1) }
    }

    private var hasAutomaticUpload: Bool {
        automaticUploadState != nil && automaticUploadState != .idle
    }

    private var uploadStatusSymbol: String {
        switch automaticUploadState {
        case .completed: "checkmark.icloud"
        case .failed: "exclamationmark.icloud"
        default: "arrow.up.doc"
        }
    }

    private var uploadStatusColor: Color {
        switch automaticUploadState {
        case .completed: LyreTheme.success
        case .failed: LyreTheme.error
        default: LyreTheme.accent
        }
    }

    private var uploadHeading: String {
        switch automaticUploadState {
        case .preparing, .presigning, .uploading, .creating: "Uploading automatically"
        case .completed: "Uploaded to Lyre"
        case .failed: "Automatic upload failed"
        case .idle, nil: "Continue in Lyre"
        }
    }

    private var uploadDescription: String {
        switch automaticUploadState {
        case .preparing, .presigning, .uploading, .creating: "Your original stays on this Mac."
        case .completed: "Open Lyre to transcribe and organize on the web."
        case .failed: "Your file is saved locally. View the upload to retry."
        case .idle, nil: "Upload to transcribe and organize on the web."
        }
    }

    private func metadataValue(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 13, weight: .medium))
        }
    }

    private func togglePlayback() {
        if isPreview {
            player.state = player.isPlaying(recording.url) ? .paused(recording.url) : .playing(recording.url)
        } else {
            player.toggle(recording.url)
        }
    }

    private func seek(to time: Double) {
        if isPreview { player.currentTime = min(max(0, time), duration) } else { player.seek(to: time) }
    }

    private func reveal() {
        if !isPreview { NSWorkspace.shared.activateFileViewerSelecting([recording.url]) }
    }

    private func formattedTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "--:--" }
        return String(format: "%02d:%02d", Int(seconds) / 60, Int(seconds) % 60)
    }
}

struct RecordingWaveform: View {
    let peaks: [Float]
    let progress: Double

    var body: some View {
        Canvas { context, size in
            guard !peaks.isEmpty else { return }
            let step = size.width / CGFloat(peaks.count)
            for (index, peak) in peaks.enumerated() {
                let height = max(2, CGFloat(peak) * size.height)
                let rect = CGRect(x: CGFloat(index) * step, y: (size.height - height) / 2,
                                  width: max(1.5, step - 2), height: height)
                let played = Double(index) / Double(peaks.count) < progress
                context.fill(Path(roundedRect: rect, cornerRadius: 1.5),
                             with: .color(LyreTheme.accent.opacity(played ? 1 : 0.24)))
            }
        }
        .accessibilityHidden(true)
    }
}
