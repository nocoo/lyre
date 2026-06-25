import Testing
import Foundation
import AVFoundation
import CoreMedia
import ScreenCaptureKit
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

    // MARK: - Permission Check on Start

    @Test func startRequiresPermissions() {
        let permissions = PermissionManager()
        permissions.screenRecording = .denied
        permissions.microphone = .denied
        let manager = RecordingManager(permissions: permissions)
        #expect(manager.permissionsObservable?.needsSetup == true)
        #expect(manager.permissions.allGranted == false)
    }
}

// MARK: - Protocol seam suite (task #5 commit 2)

@Suite("RecordingManager dual-mode wiring")
struct RecordingManagerDualModeTests {
    @Test func dualTrackPathSetsUpEncoderWithDualMode() async throws {
        let perms = FakePermissions(allGranted: true)
        let cap = FakeCapture()
        let enc = FakeEncoder()
        let mgr = RecordingManager(
            permissions: perms,
            capture: cap,
            encoderFactory: { enc },
            useDualTrack: true,
            outputDirectory: tempDir()
        )

        try await mgr.startRecording()

        #expect(enc.setupMode == .dualTrack)
        #expect(cap.onRawSystemBuffer != nil, "dual path must install raw system callback")
        #expect(cap.onRawMicBuffer != nil, "dual path must install raw mic callback")
        #expect(cap.onMixedSamples == nil, "dual path must leave legacy mixed callback nil")
        #expect(cap.startCount == 1)

        _ = try await mgr.stopRecording()
    }

    @Test func legacyPathSetsUpEncoderWithLegacyMixedMode() async throws {
        let cap = FakeCapture()
        let enc = FakeEncoder()
        let mgr = RecordingManager(
            permissions: FakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { enc },
            useDualTrack: false,
            outputDirectory: tempDir()
        )

        try await mgr.startRecording()

        #expect(enc.setupMode == .legacyMixed)
        #expect(cap.onMixedSamples != nil, "legacy path must install mixed callback")
        #expect(cap.onRawSystemBuffer == nil, "legacy path must not install raw system callback")
        #expect(cap.onRawMicBuffer == nil, "legacy path must not install raw mic callback")

        _ = try await mgr.stopRecording()
    }

    @Test func dualPathEnqueueThrowSurfacesLastError() async throws {
        let cap = FakeCapture()
        let enc = FakeEncoder()
        enc.enqueueResult = .throwError(AudioEncoder.EncoderError.wrongMode("test wrong mode"))
        let mgr = RecordingManager(
            permissions: FakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { enc },
            useDualTrack: true,
            outputDirectory: tempDir()
        )
        try await mgr.startRecording()

        cap.onRawSystemBuffer?(Self.makeBuffer())

        #expect(mgr.lastError != nil, "throwing enqueue must populate lastError")
        if let err = mgr.lastError as? AudioEncoder.EncoderError {
            #expect(err == .wrongMode("test wrong mode"))
        } else {
            Issue.record("lastError was not the expected EncoderError")
        }

        _ = try await mgr.stopRecording()
    }

    @Test func dualPathEnqueueFalseSurfacesLastError() async throws {
        let cap = FakeCapture()
        let enc = FakeEncoder()
        enc.enqueueResult = .returnFalse
        let mgr = RecordingManager(
            permissions: FakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { enc },
            useDualTrack: true,
            outputDirectory: tempDir()
        )
        try await mgr.startRecording()

        cap.onRawMicBuffer?(Self.makeBuffer())

        if case .writerFailed(let detail)? = mgr.lastError as? AudioEncoder.EncoderError {
            #expect(detail.contains("mic"))
        } else {
            Issue.record("lastError missing writerFailed(mic ...) detail; got \(String(describing: mgr.lastError))")
        }

        _ = try await mgr.stopRecording()
    }

    @Test func finalizeLastErrorCapturedDuringStop() async throws {
        let cap = FakeCapture()
        let enc = FakeEncoder()
        let finalizeFailure = AudioEncoder.EncoderError.writerFailed("simulated finishWriting failure")
        enc.finalizeLastError = finalizeFailure
        let mgr = RecordingManager(
            permissions: FakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { enc },
            useDualTrack: true,
            outputDirectory: tempDir()
        )
        try await mgr.startRecording()
        _ = try await mgr.stopRecording()
        #expect(mgr.lastError as? AudioEncoder.EncoderError == finalizeFailure)
        #expect(mgr.state == .idle)
    }

    @Test func stopRecordingClearsAllCaptureCallbacks() async throws {
        let cap = FakeCapture()
        let mgr = RecordingManager(
            permissions: FakePermissions(allGranted: true),
            capture: cap,
            encoderFactory: { FakeEncoder() },
            useDualTrack: true,
            outputDirectory: tempDir()
        )
        try await mgr.startRecording()
        _ = try await mgr.stopRecording()
        #expect(cap.onRawSystemBuffer == nil)
        #expect(cap.onRawMicBuffer == nil)
        #expect(cap.onMixedSamples == nil)
        #expect(cap.onStreamError == nil)
    }

    @Test func startWithDeniedPermissionsThrows() async {
        let mgr = RecordingManager(
            permissions: FakePermissions(allGranted: false),
            capture: FakeCapture(),
            encoderFactory: { FakeEncoder() },
            useDualTrack: true,
            outputDirectory: tempDir()
        )
        do {
            try await mgr.startRecording()
            Issue.record("Expected permissionDenied")
        } catch RecordingManager.RecordingError.permissionDenied {
            // ok
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    // MARK: - Fixtures

    private static func makeBuffer() -> CMSampleBuffer {
        let sr: Double = 48_000
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1),
              let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 480) else {
            fatalError("failed to build PCM buffer fixture")
        }
        pcm.frameLength = 480
        var fmt: CMAudioFormatDescription?
        _ = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: format.streamDescription,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &fmt
        )
        var sb: CMSampleBuffer?
        _ = CMAudioSampleBufferCreateWithPacketDescriptions(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: fmt!,
            sampleCount: 480,
            presentationTimeStamp: .zero,
            packetDescriptions: nil,
            sampleBufferOut: &sb
        )
        _ = CMSampleBufferSetDataBufferFromAudioBufferList(
            sb!,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: pcm.audioBufferList
        )
        return sb!
    }
}

private func tempDir() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("lyre-rm-test-\(UUID().uuidString)")
}

// MARK: - Fakes

private final class FakePermissions: RecordingPermissions, @unchecked Sendable {
    var allGranted: Bool
    var needsSetup: Bool { !allGranted }
    var checkAllCount = 0

    init(allGranted: Bool) {
        self.allGranted = allGranted
    }

    func checkAll() async { checkAllCount += 1 }
}

private final class FakeCapture: AudioCapturing, @unchecked Sendable {
    var availableDevices: [AudioInputDevice] = []
    var selectedDeviceID: String?
    var onMixedSamples: (([Float]) -> Void)?
    var onRawSystemBuffer: ((CMSampleBuffer) -> Void)?
    var onRawMicBuffer: ((CMSampleBuffer) -> Void)?
    var onStreamError: ((Error) -> Void)?

    var startCount = 0
    var stopCount = 0

    func refreshDevices() { /* no-op in tests */ }
    func startCapture() async throws { startCount += 1 }
    func stopCapture() async throws { stopCount += 1 }
}

private final class FakeEncoder: AudioEncoding, @unchecked Sendable {
    enum EnqueueResult {
        case returnTrue
        case returnFalse
        case throwError(Error)
    }

    var setupMode: AudioEncoder.EncoderMode?
    var setupURL: URL?
    var enqueueCalls: [(AudioEncoder.Source, CMSampleBuffer)] = []
    var enqueueResult: EnqueueResult = .returnTrue
    var encodeSamplesCalls: [[Float]] = []
    var finalizeLastError: Error?

    private var lastErrorStorage: Error?
    var lastError: Error? { lastErrorStorage }

    func setup(outputURL: URL, mode: AudioEncoder.EncoderMode) throws {
        setupURL = outputURL
        setupMode = mode
    }

    func enqueue(_ buffer: CMSampleBuffer, source: AudioEncoder.Source) throws -> Bool {
        enqueueCalls.append((source, buffer))
        switch enqueueResult {
        case .returnTrue: return true
        case .returnFalse: return false
        case .throwError(let e): throw e
        }
    }

    func encodeSamples(_ samples: [Float]) -> Bool {
        encodeSamplesCalls.append(samples)
        return true
    }

    func finalize() async {
        lastErrorStorage = finalizeLastError
    }
}
