import AVFoundation
import CoreGraphics
import os
import ScreenCaptureKit

/// Manages macOS permissions required for audio recording.
///
/// Two permissions are needed:
/// 1. **Screen & System Audio Recording** — triggered by ScreenCaptureKit,
///    grants access to system audio output (other meeting participants' voices).
/// 2. **Microphone** — grants access to the mic input (your own voice).
@Observable
final class PermissionManager: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "PermissionManager")

    enum Status: Sendable, Equatable {
        case unknown
        case granted
        case denied
    }

    // internal(set) so @testable import can mutate for testing
    internal(set) var screenRecording: Status = .unknown
    internal(set) var microphone: Status = .unknown

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
    /// UI paths that legitimately want to prompt the user should keep
    /// using `checkScreenRecording()` / `requestScreenRecording()`.
    static func hasScreenRecordingPreauthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    // MARK: - Check

    /// Check both permissions without triggering system prompts (where possible).
    func checkAll() async {
        await checkScreenRecording()
        await checkMicrophone()
    }

    /// Check screen recording permission by attempting to enumerate shareable content.
    /// ScreenCaptureKit will throw if the user has denied permission.
    ///
    /// **Side effect**: the first call on a freshly-installed app triggers the
    /// macOS Screen Recording TCC dialog. This is intentional for UI flows
    /// (About / Permissions tab) — the dialog IS the ask. Do NOT call this
    /// from test code or any headless path; use
    /// `hasScreenRecordingPreauthorized()` instead.
    func checkScreenRecording() async {
        do {
            let content = try await SCShareableContent.current
            Self.logger.info("Screen Recording: granted (\(content.displays.count) displays)")
            screenRecording = .granted
        } catch {
            Self.logger.warning("Screen Recording: denied — \(error.localizedDescription)")
            screenRecording = .denied
        }
    }

    /// Check microphone permission using AVFoundation's authorization status.
    func checkMicrophone() async {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        Self.logger.info("Microphone AVCaptureDevice status: \(status.rawValue)")
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
    func requestMicrophone() async {
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        microphone = granted ? .granted : .denied
    }

    /// Request screen recording permission by triggering a ScreenCaptureKit call.
    /// On first use, this causes macOS to show the "Screen & System Audio Recording"
    /// system alert. The user must grant permission in System Settings.
    func requestScreenRecording() async {
        await checkScreenRecording()
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
