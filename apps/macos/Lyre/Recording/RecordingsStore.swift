import Foundation
import AVFoundation
import os

/// A single local recording file with metadata.
struct RecordingFile: Identifiable, Sendable {
    let id: URL // file URL as identity
    let url: URL
    let filename: String
    let fileSize: Int64
    let createdAt: Date
    var duration: TimeInterval?

    init(url: URL, fileSize: Int64, createdAt: Date, duration: TimeInterval? = nil) {
        self.id = url
        self.url = url
        self.filename = url.deletingPathExtension().lastPathComponent
        self.fileSize = fileSize
        self.createdAt = createdAt
        self.duration = duration
    }

    /// Human-readable file size (e.g. "1.2 MB").
    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: fileSize, countStyle: .file)
    }

    /// Human-readable duration (e.g. "2:34").
    var formattedDuration: String {
        guard let d = duration, d > 0 else { return "--:--" }
        let mins = Int(d) / 60
        let secs = Int(d) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

/// Scans the output directory for M4A recording files and loads metadata.
///
/// Watches the directory for file system changes (create, delete, rename)
/// and automatically re-scans with a short debounce to avoid excessive refreshes.
@Observable
final class RecordingsStore: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "RecordingsStore")

    /// Sorted list of recordings (newest first).
    internal(set) var recordings: [RecordingFile] = []

    /// Whether a scan is in progress.
    internal(set) var isScanning: Bool = false

    /// The directory to scan.
    private let directory: URL

    /// File system event source for watching the directory.
    private var directorySource: DispatchSourceFileSystemObject?

    /// Debounce task for coalescing rapid file system events.
    private var debounceTask: Task<Void, Never>?

    /// Debounce interval for file system events.
    private static let debounceInterval: Duration = .milliseconds(500)

    init(directory: URL) {
        self.directory = directory
    }

    deinit {
        stopWatching()
    }

    // MARK: - Directory Watching

    /// Start watching the output directory for file system changes.
    ///
    /// Uses `DispatchSource.makeFileSystemObjectSource` to get kernel-level
    /// notifications when files are created, deleted, or renamed.
    func startWatching() {
        stopWatching()

        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)

        let fd = open(directory.path, O_EVTONLY)
        guard fd >= 0 else {
            Self.logger.warning("Cannot open directory for watching: \(self.directory.path)")
            return
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .delete, .rename],
            queue: .global(qos: .utility)
        )

        source.setEventHandler { [weak self] in
            self?.scheduleScan()
        }

        source.setCancelHandler {
            close(fd)
        }

        directorySource = source
        source.resume()
        Self.logger.info("Started watching directory: \(self.directory.lastPathComponent)")
    }

    /// Stop watching the directory.
    func stopWatching() {
        debounceTask?.cancel()
        debounceTask = nil

        if let source = directorySource {
            source.cancel()
            directorySource = nil
        }
    }

    /// Schedule a debounced scan after a file system event.
    private func scheduleScan() {
        debounceTask?.cancel()
        debounceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.debounceInterval)
            guard !Task.isCancelled, let self else { return }
            await self.scan()
        }
    }

    // MARK: - Scanning

    /// Scan the output directory for M4A files and load metadata.
    func scan() async {
        isScanning = true
        defer { isScanning = false }

        let fm = FileManager.default

        // Ensure directory exists
        guard fm.fileExists(atPath: directory.path) else {
            Self.logger.info("Output directory does not exist: \(self.directory.path)")
            recordings = []
            return
        }

        do {
            let contents = try fm.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.fileSizeKey, .creationDateKey],
                options: [.skipsHiddenFiles]
            )

            var files: [RecordingFile] = []
            for url in contents where url.pathExtension.lowercased() == "m4a" {
                if let file = await loadRecordingFile(url: url) {
                    files.append(file)
                }
            }

            // Sort newest first
            files.sort { $0.createdAt > $1.createdAt }
            recordings = files
            Self.logger.info("Scanned \(files.count) recordings")
        } catch {
            Self.logger.error("Failed to scan directory: \(error.localizedDescription)")
            recordings = []
        }
    }

    /// Load metadata for a single M4A file.
    private func loadRecordingFile(url: URL) async -> RecordingFile? {
        let fm = FileManager.default
        do {
            let attrs = try fm.attributesOfItem(atPath: url.path)
            let fileSize = (attrs[.size] as? Int64) ?? 0
            let createdAt = (attrs[.creationDate] as? Date) ?? Date.distantPast

            // Load audio duration
            let duration = await loadDuration(url: url)

            return RecordingFile(
                url: url,
                fileSize: fileSize,
                createdAt: createdAt,
                duration: duration
            )
        } catch {
            Self.logger.warning("Failed to read file attributes: \(url.lastPathComponent)")
            return nil
        }
    }

    /// Load the audio duration from an M4A file using AVAsset.
    private func loadDuration(url: URL) async -> TimeInterval? {
        let asset = AVAsset(url: url)
        do {
            let duration = try await asset.load(.duration)
            let seconds = CMTimeGetSeconds(duration)
            return seconds.isFinite ? seconds : nil
        } catch {
            return nil
        }
    }

    // MARK: - Delete

    /// Delete a recording file from disk and remove from the list.
    func delete(_ recording: RecordingFile) throws {
        try FileManager.default.removeItem(at: recording.url)
        recordings.removeAll { $0.id == recording.id }
        Self.logger.info("Deleted recording: \(recording.filename)")
    }

    /// Delete multiple recordings.
    func delete(_ toDelete: [RecordingFile]) throws {
        for recording in toDelete {
            try FileManager.default.removeItem(at: recording.url)
        }
        let ids = Set(toDelete.map(\.id))
        recordings.removeAll { ids.contains($0.id) }
        Self.logger.info("Deleted \(toDelete.count) recordings")
    }
}
