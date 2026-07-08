import Foundation
import os

/// Bridges `AppConfig`-persisted input device id to `AudioCapturing`'s
/// runtime selection so app startup — not the tray menu — is what
/// resolves the user's last choice.
///
/// Owned here (not on `AppConfig`) because `AppConfig` must not know
/// about capture. Owned here (not on `RecordingManager`) because the
/// binding also has to write back into config when a saved id turns
/// out to be stale, and `RecordingManager` doesn't hold config.
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
        /// Saved id was not in `availableDevices`; both config and
        /// capture were cleared so subsequent launches don't repeat the
        /// same failed restore.
        case clearedStale(String)
    }

    /// Refresh the device list, then sync `config.selectedInputDeviceID`
    /// into `capture.selectedDeviceID`. Stale ids are cleared from both
    /// sides.
    @discardableResult
    static func restore(config: AppConfig, capture: AudioCapturing) -> Outcome {
        capture.refreshDevices()

        guard let savedID = config.selectedInputDeviceID else {
            return .noSavedID
        }

        let stillAvailable = capture.availableDevices.contains { $0.id == savedID }
        if stillAvailable {
            capture.selectedDeviceID = savedID
            logger.info("Restored saved input device: \(savedID)")
            return .restored(savedID)
        } else {
            logger.info("Saved input device \(savedID) unavailable; clearing")
            config.selectedInputDeviceID = nil
            capture.selectedDeviceID = nil
            return .clearedStale(savedID)
        }
    }
}
