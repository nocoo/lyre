import Testing
import Foundation
import AVFoundation
@testable import Lyre

/// End-to-end test for the full recording lifecycle.
///
/// These tests require:
/// - Screen Recording permission (ScreenCaptureKit)
/// - Microphone permission (AVFoundation)
///
/// Tests skip gracefully when permissions are not available (CI-safe).
/// Uses `withKnownIssue` to mark permission-dependent tests as expected
/// failures when running without the required system permissions.
@Suite("E2E Recording Lifecycle")
struct RecordingE2ETests {

    /// Check if the required permissions are available.
    private static func hasPermissions() async -> Bool {
        let permissions = PermissionManager()
        await permissions.checkAll()
        print("[E2E] Screen Recording: \(permissions.screenRecording), Microphone: \(permissions.microphone), allGranted: \(permissions.allGranted)")
        return permissions.allGranted
    }

    // MARK: - Full Lifecycle

    @Test func recordAndProduceM4AFile() async throws {
        let canRun = await Self.hasPermissions()
        guard canRun else {
            withKnownIssue("Screen Recording + Microphone permissions required") {
                throw PermissionSkip()
            }
            return
        }

        // Set up recorder with a temp directory
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-e2e-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let recorder = RecordingManager(outputDirectory: tempDir)

        // Verify initial state
        #expect(recorder.state == .idle)

        // Start recording
        try await recorder.startRecording()
        #expect(recorder.state == .recording)
        #expect(recorder.currentFileURL != nil)
        #expect(recorder.recordingStartTime != nil)

        let fileURL = recorder.currentFileURL!

        // Record for 2 seconds to accumulate enough audio data
        try await Task.sleep(for: .seconds(2))

        // Stop recording
        let outputURL = try await recorder.stopRecording()
        #expect(recorder.state == .idle)
        #expect(outputURL == fileURL)

        // Verify output file exists
        #expect(FileManager.default.fileExists(atPath: outputURL.path))

        // Verify file is non-empty
        let attrs = try FileManager.default.attributesOfItem(atPath: outputURL.path)
        let fileSize = attrs[.size] as? Int ?? 0
        #expect(fileSize > 0, "M4A file should not be empty")

        // Verify it's a valid audio file
        let asset = AVAsset(url: outputURL)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        #expect(!tracks.isEmpty, "M4A should contain at least one audio track")

        // Verify duration is roughly 2 seconds (allow some tolerance)
        let duration = try await asset.load(.duration)
        let durationSeconds = CMTimeGetSeconds(duration)
        #expect(durationSeconds > 1.0, "Recording should be at least 1 second (was \(durationSeconds)s)")
        #expect(durationSeconds < 5.0, "Recording should be less than 5 seconds (was \(durationSeconds)s)")
    }

    // MARK: - Double Start Prevention

    @Test func cannotStartTwice() async throws {
        let canRun = await Self.hasPermissions()
        guard canRun else {
            withKnownIssue("Screen Recording + Microphone permissions required") {
                throw PermissionSkip()
            }
            return
        }

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-e2e-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let recorder = RecordingManager(outputDirectory: tempDir)

        try await recorder.startRecording()
        defer { Task { try? await recorder.stopRecording() } }

        do {
            try await recorder.startRecording()
            Issue.record("Expected RecordingError.alreadyRecording")
        } catch let error as RecordingManager.RecordingError {
            #expect(error == .alreadyRecording)
        }
    }

    // MARK: - Output File Naming

    @Test func outputFileHasExpectedName() async throws {
        let canRun = await Self.hasPermissions()
        guard canRun else {
            withKnownIssue("Screen Recording + Microphone permissions required") {
                throw PermissionSkip()
            }
            return
        }

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-e2e-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let recorder = RecordingManager(outputDirectory: tempDir)

        try await recorder.startRecording()
        let fileURL = recorder.currentFileURL!

        // Brief recording
        try await Task.sleep(for: .milliseconds(500))
        _ = try await recorder.stopRecording()

        #expect(fileURL.pathExtension == "m4a")
        #expect(fileURL.lastPathComponent.hasPrefix("Recording "))
        #expect(fileURL.lastPathComponent.contains(" at "))
    }
}

/// Sentinel error for permission-skip in `withKnownIssue`.
private struct PermissionSkip: Error {}
