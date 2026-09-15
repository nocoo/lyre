import SwiftUI

/// The upload workflow lives in the selected recording's detail pane.
struct UploadView: View {
    @Bindable var uploadManager: UploadManager
    let recording: RecordingFile
    @Bindable var config: AppConfig
    var isAutomatic = false
    let onDismiss: () -> Void
    @Environment(\.lyrePreview) private var isPreview

    private var isBusy: Bool { uploadManager.state.isInProgress }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                switch uploadManager.state {
                case .idle, .failed: uploadForm
                case .preparing, .presigning, .uploading, .creating: progress
                case .completed: completed
                }
            }
            .padding(24)
            .frame(maxWidth: 700, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { actions }
        .task(id: isBusy) {
            if !isPreview, !isBusy, !isCompleted { await uploadManager.fetchMetadata() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button(action: onDismiss) {
                Label("Back to recording", systemImage: "chevron.left").font(.system(size: 11))
            }
            .buttonStyle(.plain).foregroundStyle(.secondary).disabled(isBusy && !isAutomatic)
            .keyboardShortcut("[")
            VStack(alignment: .leading, spacing: 9) {
                Text(isAutomatic ? "Automatic upload" : "Upload recording")
                    .font(.system(size: 22, weight: .semibold))
                Text(recording.url.lastPathComponent).font(.system(size: 11))
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                Text("\(recording.formattedDuration)  ·  \(recording.formattedSize)")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }

    private var uploadForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            LyreCard {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Title").font(.system(size: 12, weight: .medium))
                        TextField("Recording title", text: $uploadManager.title, prompt: Text(recording.filename))
                            .textFieldStyle(.roundedBorder).controlSize(.large)
                    }
                    metadataFields
                }
            }
            if case .failed(let message) = uploadManager.state {
                Label {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Upload didn’t finish.").fontWeight(.semibold)
                        Text(message).textSelection(.enabled)
                    }
                } icon: { Image(systemName: "exclamationmark.triangle") }
                .font(.system(size: 12)).foregroundStyle(.red)
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(.red.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))
            }
            Label {
                Text("Your original stays on this Mac. After uploading, open Lyre on the web to start transcription.")
                    .lineSpacing(3)
            } icon: { Image(systemName: "internaldrive") }
            .font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var metadataFields: some View {
        if uploadManager.isFetchingMetadata {
            HStack(spacing: 8) {
                ProgressView().controlSize(.mini)
                Text("Loading folders and tags…").font(.system(size: 12)).foregroundStyle(.secondary)
            }
        } else if let error = uploadManager.metadataError {
            VStack(alignment: .leading, spacing: 10) {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 12)).foregroundStyle(.orange)
                Button("Try again") {
                    if !isPreview { Task { await uploadManager.fetchMetadata() } }
                }
                .buttonStyle(LyreButtonStyle())
            }
        } else {
            Picker("Folder", selection: $uploadManager.selectedFolderID) {
                Text("No folder").tag(String?.none)
                ForEach(uploadManager.folders) { folder in
                    Text(folder.name).tag(Optional(folder.id))
                }
            }
            .font(.system(size: 12)).controlSize(.large)
            if !uploadManager.tags.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Tags").font(.system(size: 12, weight: .medium))
                    FlowLayout(spacing: 8) {
                        ForEach(uploadManager.tags) { tag in
                            TagChip(name: tag.name, isSelected: uploadManager.selectedTagIDs.contains(tag.id)) {
                                if uploadManager.selectedTagIDs.contains(tag.id) {
                                    uploadManager.selectedTagIDs.remove(tag.id)
                                } else {
                                    uploadManager.selectedTagIDs.insert(tag.id)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 14) {
                ProgressView().controlSize(.small)
                VStack(alignment: .leading, spacing: 6) {
                    Text(progressTitle).font(.system(size: 16, weight: .semibold))
                    Text("Your original recording is safe on this Mac.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }.padding(.vertical, 12)
            LyreCard {
                VStack(alignment: .leading, spacing: 22) {
                    progressStep("Prepare audio", index: 0)
                    progressStep("Upload file", index: 1)
                    progressStep("Save to your library", index: 2)
                }
            }
        }
    }

    private var stage: Int {
        switch uploadManager.state {
        case .preparing, .presigning: 0
        case .uploading: 1
        default: 2
        }
    }

    private var progressTitle: String {
        switch uploadManager.state {
        case .preparing, .presigning: "Preparing your recording…"
        case .uploading: "Uploading audio…"
        default: "Saving to Lyre…"
        }
    }

    private func progressStep(_ title: String, index: Int) -> some View {
        HStack(spacing: 12) {
            Image(systemName: index < stage
                  ? "checkmark.circle.fill" : index == stage ? "circle.inset.filled" : "circle")
                .foregroundStyle(index < stage ? .green : index == stage ? LyreTheme.accent : .secondary)
            Text(title).foregroundStyle(index <= stage ? .primary : .secondary)
        }
        .font(.system(size: 13))
    }

    private var completed: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 42)).foregroundStyle(.green)
            VStack(spacing: 9) {
                Text("Ready in Lyre.").font(.system(size: 22, weight: .semibold))
                Text("Your recording is uploaded.\nOpen Lyre to start a transcription.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).lineSpacing(4)
            }
            LyreCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text(uploadManager.title.isEmpty ? recording.filename : uploadManager.title)
                        .font(.system(size: 13, weight: .semibold)).textSelection(.enabled)
                    if let folder = uploadManager.folders.first(where: { $0.id == uploadManager.selectedFolderID }) {
                        Label(folder.name, systemImage: "folder").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    let names = uploadManager.tags
                        .filter { uploadManager.selectedTagIDs.contains($0.id) }.map(\.name)
                    if !names.isEmpty {
                        Label(names.joined(separator: ", "), systemImage: "tag")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 16).frame(maxWidth: .infinity)
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button(isBusy ? "Cancel upload" : isCompleted ? "Done" : "Cancel") {
                if isBusy { uploadManager.cancel() }
                onDismiss()
            }
            .buttonStyle(LyreButtonStyle()).keyboardShortcut(.cancelAction)
            Spacer(minLength: 0)
            if case .completed(let id) = uploadManager.state {
                Button("Open in Lyre", systemImage: "arrow.up.right") { openRecording(id) }
                    .buttonStyle(LyreButtonStyle(treatment: .accent)).keyboardShortcut(.defaultAction)
            } else if !isBusy {
                Button(uploadTitle, systemImage: "arrow.up") {
                    if isPreview {
                        uploadManager.state = .uploading(progress: 0)
                    } else {
                        uploadManager.upload(file: recording)
                    }
                }
                .buttonStyle(LyreButtonStyle(treatment: .accent)).keyboardShortcut(.defaultAction)
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 18)
        .background(LyreTheme.canvas)
        .overlay(alignment: .top) { LyreTheme.separator.frame(height: 1) }
    }

    private var isCompleted: Bool {
        if case .completed = uploadManager.state { return true }
        return false
    }

    private var uploadTitle: String {
        if case .failed = uploadManager.state { return "Retry upload" }
        return "Upload"
    }

    private func openRecording(_ id: String) {
        guard !isPreview, let base = URL(string: config.serverURL) else { return }
        NSWorkspace.shared.open(base.appendingPathComponent("recordings").appendingPathComponent(id))
    }
}

struct TagChip: View {
    let name: String
    let isSelected: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 5) {
                if isSelected { Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold)) }
                Text(name).lineLimit(1).truncationMode(.middle)
            }
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 10).frame(height: 26)
            .frame(maxWidth: 180)
            .foregroundStyle(isSelected ? LyreTheme.accent : .secondary)
            .background(isSelected ? LyreTheme.accent.opacity(0.1) : LyreTheme.control, in: Capsule())
            .overlay { Capsule().strokeBorder(isSelected ? LyreTheme.accent.opacity(0.3) : .clear, lineWidth: 1) }
        }
        .buttonStyle(.plain).help(name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var height: CGFloat = 0
        for (index, row) in rows.enumerated() {
            let rowHeight = row.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
            height += rowHeight
            if index < rows.count - 1 { height += spacing }
        }
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            let rowHeight = row.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
            for subview in row {
                let size = subview.sizeThatFits(.unspecified)
                subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += rowHeight + spacing
        }
    }

    private func computeRows(proposal: ProposedViewSize, subviews: Subviews) -> [[LayoutSubviews.Element]] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[LayoutSubviews.Element]] = [[]]
        var currentRowWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentRowWidth + size.width > maxWidth && !rows[rows.count - 1].isEmpty {
                rows.append([])
                currentRowWidth = 0
            }
            rows[rows.count - 1].append(subview)
            currentRowWidth += size.width + spacing
        }

        return rows
    }
}
