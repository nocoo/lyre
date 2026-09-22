import AppKit
import AVFoundation
import CoreGraphics
import os

/// Manages macOS permissions required for audio recording.
///
/// Two permissions are needed:
/// 1. **Screen & System Audio Recording** — triggered by ScreenCaptureKit,
///    grants access to system audio output (other meeting participants' voices).
/// 2. **Microphone** — grants access to the mic input (your own voice).
@Observable
final class PermissionManager: @unchecked Sendable {
    private static let logger = Logger(subsystem: "ai.hexly.lyre", category: "Permissions")

    enum Status: Sendable, Equatable {
        case unknown
        case granted
        case denied
    }

    // Internal so @testable import can mutate these in tests.
    var screenRecording: Status = .unknown
    var microphone: Status = .unknown
    private(set) var isRequestingMicrophone = false
    private(set) var isRequestingScreenRecording = false
    private(set) var screenRecordingIssue: String?
    private var verifiedScreenRecording: Status?
    private var screenVerificationTask: Task<ScreenCapturePermissionProbe.Result, Never>?
    private var shouldVerifyAfterSettings = false

    private let screenAccess: @MainActor () -> Bool
    private let microphoneStatus: @MainActor () -> AVAuthorizationStatus
    private let askForMicrophone: @MainActor () async -> Bool
    private let screenCaptureProbe: @MainActor () async -> ScreenCapturePermissionProbe.Result
    private let openSystemSettings: @MainActor (URL) -> Void

    init(
        screenAccess: @escaping @MainActor () -> Bool = { CGPreflightScreenCaptureAccess() },
        microphoneStatus: @escaping @MainActor () -> AVAuthorizationStatus = {
            AVCaptureDevice.authorizationStatus(for: .audio)
        },
        askForMicrophone: @escaping @MainActor () async -> Bool = {
            await AVCaptureDevice.requestAccess(for: .audio)
        },
        screenCaptureProbe: @escaping @MainActor () async -> ScreenCapturePermissionProbe.Result = {
            await ScreenCapturePermissionProbe.check()
        },
        openSystemSettings: @escaping @MainActor (URL) -> Void = { _ = NSWorkspace.shared.open($0) }
    ) {
        self.screenAccess = screenAccess
        self.microphoneStatus = microphoneStatus
        self.askForMicrophone = askForMicrophone
        self.screenCaptureProbe = screenCaptureProbe
        self.openSystemSettings = openSystemSettings
    }

    var allGranted: Bool {
        screenRecording == .granted && microphone == .granted
    }

    var needsSetup: Bool {
        screenRecording != .granted || microphone != .granted
    }

    /// Convenience accessor exposed by `RecordingPermissions` so consumers
    /// (e.g. `TeamsMeetingWatcher`) can check SCK-only grants without knowing
    /// about the concrete `Status` enum.
    var screenCaptureGranted: Bool {
        screenRecording == .granted
    }

    /// Conservative, non-prompting gate for opt-in live tests. A false result
    /// can be stale for this process and must not block interactive recording
    /// without checking ScreenCaptureKit itself.
    static func hasScreenRecordingPreauthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    // MARK: - Check

    /// Refresh the navigation UI without making simply visiting a page request consent.
    @MainActor func refreshStatusWithoutPrompt() async {
        await checkScreenRecording()
        await checkMicrophone()
    }

    /// Passive checks never ask for consent; recording preparation is explicit.
    @MainActor func checkAll() async {
        await refreshStatusWithoutPrompt()
    }

    /// Preflight is only a hint: macOS can cache it for this process's lifetime.
    /// A ScreenCaptureKit verdict takes precedence over either cached value.
    @MainActor func checkScreenRecording() async {
        if let verifiedScreenRecording {
            screenRecording = verifiedScreenRecording
            return
        }
        screenRecording = screenAccess() ? .granted : (screenRecording == .unknown ? .unknown : .denied)
    }

    /// User-initiated recording must be able to recover from a false preflight.
    /// The recorder still asks ScreenCaptureKit to start, which enforces access.
    @MainActor func prepareForRecording() async throws {
        await checkAll()
        guard microphone == .granted, screenRecording != .granted else { return }
        if case .unavailable(let message) = await verifyScreenRecordingAccess() {
            throw VerificationError.unavailable(message)
        }
    }

    /// Explicit "Check access" / "Refresh status" action. No audio is captured.
    @MainActor func verifyRecordingAccess() async {
        await checkMicrophone()
        await verifyScreenRecordingAccess()
    }

    /// Only returning from a Settings action initiated by Lyre performs an
    /// interactive verification. Ordinary activations remain non-prompting.
    @MainActor func handleApplicationActivation() async {
        await checkAll()
        guard shouldVerifyAfterSettings else { return }
        shouldVerifyAfterSettings = false
        await verifyScreenRecordingAccess()
    }

    @discardableResult
    @MainActor private func verifyScreenRecordingAccess() async -> ScreenCapturePermissionProbe.Result {
        if let screenVerificationTask { return await screenVerificationTask.value }
        isRequestingScreenRecording = true
        screenRecordingIssue = nil
        let task = Task<ScreenCapturePermissionProbe.Result, Never> { @MainActor [self] in
            let result = await screenCaptureProbe()
            // An actual capture denial can invalidate an older, still-running check.
            guard !Task.isCancelled else { return .denied }
            switch result {
            case .granted:
                verifiedScreenRecording = .granted
                screenRecording = .granted
            case .denied:
                verifiedScreenRecording = .denied
                screenRecording = .denied
            case .unavailable(let message):
                screenRecordingIssue = message
            }
            Self.logger.info("ScreenCaptureKit access check: \(String(describing: result), privacy: .public)")
            isRequestingScreenRecording = false
            screenVerificationTask = nil
            return result
        }
        screenVerificationTask = task
        return await task.value
    }

    /// Neither a stale positive preflight nor a late check may erase a real
    /// access denial from a recording or meeting-content query.
    @MainActor func reportScreenCaptureFailure(_ error: Error) {
        guard ScreenCapturePermissionProbe.result(for: error) == .denied else { return }
        screenVerificationTask?.cancel()
        screenVerificationTask = nil
        isRequestingScreenRecording = false
        verifiedScreenRecording = .denied
        screenRecording = .denied
        screenRecordingIssue = nil
        Self.logger.notice("ScreenCaptureKit reported an access denial; access needs verification.")
    }

    /// Check microphone permission using AVFoundation's authorization status.
    @MainActor func checkMicrophone() async {
        let status = microphoneStatus()
        switch status {
        case .authorized:
            microphone = .granted
        case .denied, .restricted:
            microphone = .denied
        case .notDetermined:
            microphone = .unknown
        @unknown default:
            microphone = .unknown
        }
    }

    // MARK: - Request

    /// Request microphone access. This triggers the system permission dialog
    /// if the user has not yet been asked.
    @MainActor func requestMicrophone() async {
        guard !isRequestingMicrophone else { return }
        await checkMicrophone()
        guard microphone == .unknown else { return }
        isRequestingMicrophone = true
        defer { isRequestingMicrophone = false }
        let granted = await askForMicrophone()
        microphone = granted ? .granted : .denied
    }

    /// Request via the capture framework, not the process-cached CG request API.
    @MainActor func requestScreenRecording() async {
        guard screenRecording != .granted else { return }
        await verifyScreenRecordingAccess()
    }

    // MARK: - System Settings

    /// Open the Screen Recording pane in System Settings.
    @MainActor func openScreenRecordingSettings() {
        shouldVerifyAfterSettings = true
        let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        )!
        openSystemSettings(url)
    }

    /// Open the Microphone pane in System Settings.
    @MainActor func openMicrophoneSettings() {
        let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        )!
        openSystemSettings(url)
    }

    enum VerificationError: LocalizedError {
        case unavailable(String)

        var errorDescription: String? {
            switch self {
            case .unavailable(let message): "Could not verify system audio access. \(message)"
            }
        }
    }
}
