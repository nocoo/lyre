import Testing
import Foundation
import AVFoundation
@testable import Lyre

@Suite("RecordingsStore Tests")
struct RecordingsStoreTests {

    /// Create a temporary directory with optional M4A fixture files.
    private func makeTempDir() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-recordings-test-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func cleanup(_ dir: URL) {
        try? FileManager.default.removeItem(at: dir)
    }

    /// Create a minimal valid M4A file for testing.
    private func createDummyM4A(in dir: URL, name: String, content: Data? = nil) -> URL {
        let url = dir.appendingPathComponent(name)
        let data = content ?? Data(repeating: 0, count: 1024)
        try! data.write(to: url)
        return url
    }

    // MARK: - Scan

    @Test func scanEmptyDirectory() async {
        let dir = makeTempDir()
        defer { cleanup(dir) }

        let store = RecordingsStore(directory: dir)
        await store.scan()

        #expect(store.recordings.isEmpty)
        #expect(!store.isScanning)
    }

    @Test func scanNonexistentDirectory() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("nonexistent-\(UUID().uuidString)", isDirectory: true)

        let store = RecordingsStore(directory: dir)
        await store.scan()

        #expect(store.recordings.isEmpty)
    }

    @Test func scanFindsM4AFiles() async {
        let dir = makeTempDir()
        defer { cleanup(dir) }

        _ = createDummyM4A(in: dir, name: "Recording 2026-02-26 at 10.00.00.m4a")
        _ = createDummyM4A(in: dir, name: "Recording 2026-02-26 at 11.00.00.m4a")
        // Non-M4A files should be ignored
        try! "not audio".data(using: .utf8)!.write(to: dir.appendingPathComponent("notes.txt"))

        let store = RecordingsStore(directory: dir)
        await store.scan()

        #expect(store.recordings.count == 2)
    }

    @Test func scanIgnoresHiddenFiles() async {
        let dir = makeTempDir()
        defer { cleanup(dir) }

        _ = createDummyM4A(in: dir, name: "visible.m4a")
        _ = createDummyM4A(in: dir, name: ".hidden.m4a")

        let store = RecordingsStore(directory: dir)
        await store.scan()

        #expect(store.recordings.count == 1)
        #expect(store.recordings[0].filename == "visible")
    }

    @Test func scanSortsNewestFirst() async {
        let dir = makeTempDir()
        defer { cleanup(dir) }

        let url1 = createDummyM4A(in: dir, name: "older.m4a")
        // Sleep briefly to ensure different creation timestamps
        try? await Task.sleep(for: .milliseconds(50))
        _ = createDummyM4A(in: dir, name: "newer.m4a")

        // Force older timestamp on first file
        let pastDate = Date().addingTimeInterval(-3600)
        try? FileManager.default.setAttributes(
            [.creationDate: pastDate],
            ofItemAtPath: url1.path
        )

        let store = RecordingsStore(directory: dir)
        await store.scan()

        #expect(store.recordings.count == 2)
        #expect(store.recordings[0].filename == "newer")
        #expect(store.recordings[1].filename == "older")
    }

    // MARK: - RecordingFile properties

    @Test func recordingFileFormattedSize() {
        let file = RecordingFile(
            url: URL(fileURLWithPath: "/test.m4a"),
            fileSize: 1_500_000,
            createdAt: Date()
        )
        // ByteCountFormatter varies by locale, just check it's non-empty
        #expect(!file.formattedSize.isEmpty)
    }

    @Test func recordingFileFormattedDuration() {
        let file1 = RecordingFile(
            url: URL(fileURLWithPath: "/test.m4a"),
            fileSize: 0,
            createdAt: Date(),
            duration: 154 // 2:34
        )
        #expect(file1.formattedDuration == "2:34")

        let file2 = RecordingFile(
            url: URL(fileURLWithPath: "/test.m4a"),
            fileSize: 0,
            createdAt: Date(),
            duration: nil
        )
        #expect(file2.formattedDuration == "--:--")
    }

    @Test func recordingFileFilename() {
        let file = RecordingFile(
            url: URL(fileURLWithPath: "/path/Recording 2026-02-26 at 10.30.45.m4a"),
            fileSize: 0,
            createdAt: Date()
        )
        #expect(file.filename == "Recording 2026-02-26 at 10.30.45")
    }

    // MARK: - Delete

    @Test func deleteSingleRecording() async throws {
        let dir = makeTempDir()
        defer { cleanup(dir) }

        _ = createDummyM4A(in: dir, name: "keep.m4a")
        _ = createDummyM4A(in: dir, name: "delete-me.m4a")

        let store = RecordingsStore(directory: dir)
        await store.scan()
        #expect(store.recordings.count == 2)

        let toDelete = store.recordings.first { $0.filename == "delete-me" }!
        try store.delete(toDelete)

        #expect(store.recordings.count == 1)
        #expect(store.recordings[0].filename == "keep")
        #expect(!FileManager.default.fileExists(atPath: toDelete.url.path))
    }

    @Test func deleteMultipleRecordings() async throws {
        let dir = makeTempDir()
        defer { cleanup(dir) }

        _ = createDummyM4A(in: dir, name: "a.m4a")
        _ = createDummyM4A(in: dir, name: "b.m4a")
        _ = createDummyM4A(in: dir, name: "c.m4a")

        let store = RecordingsStore(directory: dir)
        await store.scan()
        #expect(store.recordings.count == 3)

        let toDelete = store.recordings.filter { $0.filename == "a" || $0.filename == "c" }
        try store.delete(toDelete)

        #expect(store.recordings.count == 1)
        #expect(store.recordings[0].filename == "b")
    }
}
