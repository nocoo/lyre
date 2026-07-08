import Foundation

/// Result of resolving the microphone input device that a capture
/// session should ask ScreenCaptureKit to use.
///
/// Kept as a value type so tests can assert exactly which branch fired
/// without inspecting the SCK config (which is a local object built
/// inside `AudioCaptureManager.startCapture()` and cannot be observed).
struct EffectiveInputDevice: Equatable {
    /// Where the effective device came from. `.scPicked` means we could
    /// not resolve a UID at all and SCK will fall back to its own
    /// "system default" behaviour internally (see docs/06 — this is the
    /// black-box path we would rather avoid on macOS 15).
    enum Source: String, Equatable {
        case saved
        case `default`
        case scPicked
    }

    /// The user's persisted selection, verbatim. `nil` = "follow the
    /// system default", which we never write back into config.
    let selectedID: String?
    /// The UID to hand to SCK for this session. `nil` iff `source ==
    /// .scPicked`.
    let effectiveID: String?
    let source: Source
}

enum InputDeviceResolver {
    /// Pure resolver. Never mutates config or capture state.
    ///
    /// - Parameters:
    ///   - selected: `AudioCapturing.selectedDeviceID`. `nil` means the
    ///     user is on "System Default".
    ///   - availableDefault: The system's current default input device
    ///     UID (e.g. `AVCaptureDevice.default(for: .audio)?.uniqueID`).
    ///     Passed in as a parameter so tests do not need to touch
    ///     AVFoundation.
    static func resolve(
        selected: String?,
        availableDefault: String?
    ) -> EffectiveInputDevice {
        if let selected {
            return EffectiveInputDevice(
                selectedID: selected,
                effectiveID: selected,
                source: .saved
            )
        }
        if let availableDefault {
            return EffectiveInputDevice(
                selectedID: nil,
                effectiveID: availableDefault,
                source: .default
            )
        }
        return EffectiveInputDevice(
            selectedID: nil,
            effectiveID: nil,
            source: .scPicked
        )
    }
}
