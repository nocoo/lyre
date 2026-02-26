import SwiftUI

/// Upload form for sending a local recording to the Lyre server.
///
/// Opened from the RecordingsView context menu on a recording.
struct UploadView: View {
    @Bindable var uploadManager: UploadManager
    let recording: RecordingFile
    var onDismiss: () -> Void

    @State private var hasStarted = false

    var body: some View {
        VStack(spacing: 20) {
            // Header
            header

            Divider()

            switch uploadManager.state {
            case .idle, .failed:
                uploadForm
            case .presigning, .uploading, .creating:
                progressView
            case .completed(let recordingId):
                completedView(recordingId: recordingId)
            }
        }
        .padding(24)
        .frame(width: 460)
        .onAppear {
            if !hasStarted {
                hasStarted = true
                uploadManager.title = recording.filename
                Task { await uploadManager.fetchMetadata() }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 4) {
            Text("Upload Recording")
                .font(.title3)
                .fontWeight(.semibold)

            HStack(spacing: 8) {
                Label(recording.formattedDuration, systemImage: "clock")
                Label(recording.formattedSize, systemImage: "doc")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Upload Form

    private var uploadForm: some View {
        VStack(spacing: 16) {
            // Title
            TextField("Title", text: $uploadManager.title, prompt: Text(recording.filename))
                .textFieldStyle(.roundedBorder)

            // Folder picker
            if uploadManager.isFetchingMetadata {
                HStack {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading folders & tags...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                if !uploadManager.folders.isEmpty {
                    Picker("Folder", selection: $uploadManager.selectedFolderID) {
                        Text("None").tag(String?.none)
                        ForEach(uploadManager.folders) { folder in
                            Text(folder.name).tag(Optional(folder.id))
                        }
                    }
                }

                // Tag selection
                if !uploadManager.tags.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tags")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        FlowLayout(spacing: 6) {
                            ForEach(uploadManager.tags) { tag in
                                TagChip(
                                    name: tag.name,
                                    isSelected: uploadManager.selectedTagIDs.contains(tag.id),
                                    onToggle: {
                                        if uploadManager.selectedTagIDs.contains(tag.id) {
                                            uploadManager.selectedTagIDs.remove(tag.id)
                                        } else {
                                            uploadManager.selectedTagIDs.insert(tag.id)
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Error message
            if case .failed(let message) = uploadManager.state {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            // Action buttons
            HStack {
                Button("Cancel") { onDismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Upload") {
                    uploadManager.upload(file: recording)
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
    }

    // MARK: - Progress View

    private var progressView: some View {
        VStack(spacing: 16) {
            if case .uploading(let progress) = uploadManager.state {
                ProgressView(value: progress)
                Text("Uploading to server...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if case .presigning = uploadManager.state {
                ProgressView()
                    .controlSize(.small)
                Text("Preparing upload...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if case .creating = uploadManager.state {
                ProgressView()
                    .controlSize(.small)
                Text("Creating recording...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button("Cancel Upload") {
                uploadManager.cancel()
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    // MARK: - Completed View

    private func completedView(recordingId: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.green)

            Text("Upload Complete")
                .font(.headline)

            Text("Recording ID: \(recordingId)")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Done") {
                uploadManager.reset()
                onDismiss()
            }
            .keyboardShortcut(.defaultAction)
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }
}

// MARK: - Tag Chip

struct TagChip: View {
    let name: String
    let isSelected: Bool
    var onToggle: () -> Void

    var body: some View {
        Button {
            onToggle()
        } label: {
            Text(name)
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(
                    isSelected ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.1),
                    in: Capsule()
                )
                .overlay(
                    Capsule().stroke(
                        isSelected ? Color.accentColor : Color.clear,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Flow Layout (simple wrapping layout for tags)

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
