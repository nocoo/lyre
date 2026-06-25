import Testing
import Foundation
import AVFoundation
import ScreenCaptureKit
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
        print(
            "[E2E] Screen Recording: \(permissions.screenRecording), " +
            "Microphone: \(permissions.microphone), allGranted: \(permissions.allGranted)"
        )
        guard permissions.allGranted else { return false }

        // Even with permissions granted, the runner may have no display
        // available (headless CI / locked screen). SCShareableContent.displays
        // is empty in that case, and the recorder fails with `noDisplayFound`.
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true,
            )
            if content.displays.isEmpty {
                print("[E2E] No displays available — skipping")
                return false
            }
            return true
        } catch {
            print("[E2E] SCShareableContent failed: \(error) — skipping")
            return false
        }
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

        // Conditional sidecar consistency check (task #6 commit 2).
        // The dualTrack path writes a `tracks.json` next to the m4a
        // mapping role → trackID. In live SCK runs we cannot guarantee
        // both sources produce real buffers (locked screen / no system
        // audio playing / mic muted), and AudioEncoder only records
        // roles for sources that actually appended real buffers — so
        // the sidecar might map zero, one, or two roles. If it exists,
        // it must be internally consistent with the finalized asset.
        let sidecarURL = outputURL.deletingPathExtension().appendingPathExtension("tracks.json")
        if FileManager.default.fileExists(atPath: sidecarURL.path) {
            try Self.assertSidecarConsistent(sidecarURL: sidecarURL, audioTracks: tracks)
        }
    }

    /// Validate a sidecar JSON file matches the asset it describes.
    /// Used only when the sidecar exists; absence is allowed in live
    /// E2E because dualTrack only emits sidecar for sources that
    /// actually appended a real buffer.
    private static func assertSidecarConsistent(
        sidecarURL: URL,
        audioTracks: [AVAssetTrack]
    ) throws {
        let data = try Data(contentsOf: sidecarURL)
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let mapping = raw["tracks"] as? [String: Any] ?? [:]

        let allowedRoles: Set<String> = ["system", "mic"]
        let actualTrackIDs = Set(audioTracks.map(\.trackID))

        // Every role must be from the allowed set; every trackID must
        // be a real audio track of the finalized asset.
        for (role, value) in mapping {
            #expect(allowedRoles.contains(role), "sidecar role '\(role)' must be system or mic")
            guard let n = value as? NSNumber else {
                Issue.record("sidecar value for role '\(role)' is not a number: \(value)")
                continue
            }
            let trackID = CMPersistentTrackID(n.int32Value)
            #expect(actualTrackIDs.contains(trackID), "sidecar trackID \(trackID) for '\(role)' not in asset")
        }

        // Role count should match audio track count: AudioEncoder
        // skips the sidecar entirely when the two counts differ
        // (Reviewer Finding 5 / task #4). Seeing a sidecar with
        // mismatched counts means the encoder's defensive skip broke.
        #expect(
            mapping.count == audioTracks.count,
            "sidecar role count (\(mapping.count)) must match audio track count (\(audioTracks.count))"
        )
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
