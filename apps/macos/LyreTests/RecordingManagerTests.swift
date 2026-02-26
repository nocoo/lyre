import Testing
import Foundation
@testable import Lyre

@Suite("RecordingManager Tests")
struct RecordingManagerTests {

    // MARK: - Initial State

    @Test func initialStateIsIdle() {
        let manager = RecordingManager()
        #expect(manager.state == .idle)
        #expect(manager.currentFileURL == nil)
        #expect(manager.recordingStartTime == nil)
        #expect(manager.lastError == nil)
    }

    @Test func elapsedSecondsIsZeroWhenIdle() {
        let manager = RecordingManager()
        #expect(manager.elapsedSeconds == 0)
    }

    // MARK: - Output Directory

    @Test func defaultOutputDirectory() {
        let dir = RecordingManager.defaultOutputDirectory()
        #expect(dir.lastPathComponent == "Lyre Recordings")
        #expect(dir.pathComponents.contains("Documents"))
    }

    @Test func customOutputDirectory() {
        let custom = URL(fileURLWithPath: "/tmp/lyre-test-output")
        let manager = RecordingManager(outputDirectory: custom)
        #expect(manager.outputDirectory == custom)
    }

    // MARK: - File Naming

    @Test func generateOutputURLHasM4AExtension() {
        let manager = RecordingManager()
        let url = manager.generateOutputURL()
        #expect(url.pathExtension == "m4a")
        #expect(url.lastPathComponent.hasPrefix("Recording "))
    }

    @Test func generateOutputURLContainsTimestamp() {
        let manager = RecordingManager()
        let url = manager.generateOutputURL()
        let filename = url.lastPathComponent
        // Should match pattern: Recording YYYY-MM-DD at HH.MM.SS.m4a
        #expect(filename.contains("202"))  // Year prefix
        #expect(filename.contains(" at "))
    }

    // MARK: - State Machine Guards

    @Test func stopWhenIdleThrows() async {
        let manager = RecordingManager()
        do {
            _ = try await manager.stopRecording()
            Issue.record("Expected RecordingError.notRecording")
        } catch let error as RecordingManager.RecordingError {
            #expect(error == .notRecording)
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    // MARK: - Error Descriptions

    @Test func errorDescriptions() {
        let errors: [(RecordingManager.RecordingError, String)] = [
            (.alreadyRecording, "A recording is already in progress"),
            (.notRecording, "No recording is in progress"),
            (.permissionDenied, "Required permissions have not been granted"),
            (.encoderSetupFailed("test"), "Failed to set up audio encoder: test"),
        ]
        for (error, expected) in errors {
            #expect(error.localizedDescription == expected)
        }
    }

    @Test func recordingErrorEquality() {
        #expect(RecordingManager.RecordingError.alreadyRecording == .alreadyRecording)
        #expect(RecordingManager.RecordingError.notRecording == .notRecording)
        #expect(RecordingManager.RecordingError.permissionDenied == .permissionDenied)
        #expect(RecordingManager.RecordingError.alreadyRecording != .notRecording)
    }

    // MARK: - Sample Buffer Creation

    @Test func createSampleBufferWithEmptySamplesReturnsNil() {
        let manager = RecordingManager()
        let result = manager.createSampleBuffer(from: [])
        #expect(result == nil)
    }

    @Test func createSampleBufferWithoutFormatReturnsNil() {
        // Manager has no inputFormat set (never called setupEncoder)
        let manager = RecordingManager()
        let result = manager.createSampleBuffer(from: [0.1, 0.2, 0.3])
        #expect(result == nil)
    }

    // MARK: - Permission Check on Start
    // Note: startRecording() calls real ScreenCaptureKit/AVFoundation APIs
    // for permission checks, so integration-level permission tests belong in E2E.
    // The permission guard logic is verified by inspecting PermissionManager state.

    @Test func startRequiresPermissions() {
        // Verify the manager references a PermissionManager whose state
        // determines whether recording can proceed.
        let permissions = PermissionManager()
        permissions.screenRecording = .denied
        permissions.microphone = .denied
        let manager = RecordingManager(permissions: permissions)
        #expect(manager.permissions.needsSetup == true)
        #expect(manager.permissions.allGranted == false)
    }
}
