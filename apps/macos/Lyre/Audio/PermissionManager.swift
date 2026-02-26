import AVFoundation
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
    private static let logger = Logger(subsystem: "com.lyre.app", category: "PermissionManager")

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

    // MARK: - Check

    /// Check both permissions without triggering system prompts (where possible).
    func checkAll() async {
        await checkScreenRecording()
        await checkMicrophone()
    }

    /// Check screen recording permission by attempting to enumerate shareable content.
    /// ScreenCaptureKit will throw if the user has denied permission.
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
