import Foundation
import os

/// Bridges `AppConfig`-persisted input device id to `AudioCapturing`'s
/// runtime selection so app startup — not the tray menu — is what
/// resolves the user's last choice.
///
/// Keep the preference when a headset sleeps or a USB microphone disconnects;
/// the capture manager resolves an available route separately.
enum InputDeviceRestore {
    private static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "InputDeviceRestore"
    )

    /// Observable outcome of a restore attempt. Kept as a value type so
    /// tests can assert exactly which branch ran without inspecting
    /// mutable state on the collaborators after the fact.
    enum Outcome: Equatable {
        /// No saved id — capture stays on `nil` (system default).
        case noSavedID
        /// Saved id was present in `availableDevices` and applied.
        case restored(String)
        /// Saved device is temporarily absent. Keep it for reconnection.
        case unavailable(String)
    }

    /// Restore the preference, then refresh devices. Resolve at capture time.
    @discardableResult
    @MainActor static func restore(config: AppConfig, capture: AudioCapturing) -> Outcome {
        capture.selectedDeviceID = config.selectedInputDeviceID
        capture.refreshDevices()

        guard let savedID = config.selectedInputDeviceID else {
            return .noSavedID
        }

        let stillAvailable = capture.availableDevices.contains { $0.id == savedID }
        if stillAvailable {
            logger.info("Restored saved input device: \(savedID)")
            return .restored(savedID)
        } else {
            logger.info("Saved input device \(savedID) unavailable; keeping preference")
            return .unavailable(savedID)
        }
    }
}
