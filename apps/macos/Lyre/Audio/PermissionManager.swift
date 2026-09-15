import AppKit
import AVFoundation
import CoreGraphics

/// Manages macOS permissions required for audio recording.
///
/// Two permissions are needed:
/// 1. **Screen & System Audio Recording** — triggered by ScreenCaptureKit,
///    grants access to system audio output (other meeting participants' voices).
/// 2. **Microphone** — grants access to the mic input (your own voice).
@Observable
final class PermissionManager: @unchecked Sendable {
    enum Status: Sendable, Equatable {
        case unknown
        case granted
        case denied
    }

    // internal(set) so @testable import can mutate for testing
    internal(set) var screenRecording: Status = .unknown
    internal(set) var microphone: Status = .unknown
    private(set) var isRequestingMicrophone = false
    private(set) var isRequestingScreenRecording = false

    private let screenAccess: @MainActor () -> Bool
    private let microphoneStatus: @MainActor () -> AVAuthorizationStatus
    private let askForMicrophone: @MainActor () async -> Bool
    private let askForScreenAccess: @MainActor () -> Bool

    init(
        screenAccess: @escaping @MainActor () -> Bool = { CGPreflightScreenCaptureAccess() },
        microphoneStatus: @escaping @MainActor () -> AVAuthorizationStatus = {
            AVCaptureDevice.authorizationStatus(for: .audio)
        },
        askForMicrophone: @escaping @MainActor () async -> Bool = {
            await AVCaptureDevice.requestAccess(for: .audio)
        },
        askForScreenAccess: @escaping @MainActor () -> Bool = { CGRequestScreenCaptureAccess() }
    ) {
        self.screenAccess = screenAccess
        self.microphoneStatus = microphoneStatus
        self.askForMicrophone = askForMicrophone
        self.askForScreenAccess = askForScreenAccess
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

    /// Non-interactive probe for Screen Recording permission. Returns
    /// `true` only when TCC has already recorded a grant for this app;
    /// **never triggers a system dialog**.
    ///
    /// Uses `CGPreflightScreenCaptureAccess()`, Apple's documented
    /// read-only check. Prefer this in tests / CI / any code path where
    /// spawning a permission prompt would be surprising or destructive
    /// (pre-commit hooks, headless test runs).
    ///
    /// Only the explicit Allow Access action requests a grant.
    static func hasScreenRecordingPreauthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    // MARK: - Check

    /// Refresh the navigation UI without making simply visiting a page request consent.
    @MainActor func refreshStatusWithoutPrompt() async {
        await checkScreenRecording()
        await checkMicrophone()
    }

    /// Recording entry points and passive UI refreshes never ask for consent.
    @MainActor func checkAll() async {
        await refreshStatusWithoutPrompt()
    }

    /// A content-enumeration failure is not evidence of a revoked permission.
    @MainActor func checkScreenRecording() async {
        screenRecording = screenAccess() ? .granted : (screenRecording == .unknown ? .unknown : .denied)
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

    /// macOS owns this consent dialog. Status is refreshed when the user returns.
    @MainActor func requestScreenRecording() async {
        guard !isRequestingScreenRecording else { return }
        await checkScreenRecording()
        guard screenRecording != .granted else { return }
        isRequestingScreenRecording = true
        defer { isRequestingScreenRecording = false }
        screenRecording = askForScreenAccess() ? .granted : .denied
    }

    // MARK: - System Settings

    /// Open the Screen Recording pane in System Settings.
    func openScreenRecordingSettings() {
        let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        )!
        NSWorkspace.shared.open(url)
    }

    /// Open the Microphone pane in System Settings.
    func openMicrophoneSettings() {
        let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        )!
        NSWorkspace.shared.open(url)
    }
}
