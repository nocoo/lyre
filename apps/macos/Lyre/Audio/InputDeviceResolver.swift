import Foundation

/// Result of resolving the microphone input device that a capture
/// session should ask ScreenCaptureKit to use.
///
/// Kept as a value type so tests can assert exactly which branch fired
/// without inspecting the SCK config (which is a local object built
/// inside `AudioCaptureManager.startCapture()` and cannot be observed).
struct EffectiveInputDevice: Equatable {
    /// Keep the saved preference separate from the available capture route.
    enum Source: String, Equatable {
        case saved
        case `default`
        case unavailable
    }

    /// The user's persisted selection, verbatim. `nil` = "follow the
    /// system default", which we never write back into config.
    let selectedID: String?
    /// No UID means there is no usable input; never ask SCK to guess one.
    let effectiveID: String?
    let source: Source
}

enum InputDeviceResolver {
    /// Pure resolver. Never mutates config or capture state.
    ///
    /// - Parameters:
    ///   - selected: `AudioCapturing.selectedDeviceID`. `nil` means the
    ///     user is on "System Default".
    ///   - availableDefault: CoreAudio's current default input UID.
    ///   - availableIDs: Freshly enumerated, connected input devices.
    static func resolve(
        selected: String?,
        availableDefault: String?,
        availableIDs: Set<String>
    ) -> EffectiveInputDevice {
        if let selected, availableIDs.contains(selected) {
            return EffectiveInputDevice(
                selectedID: selected,
                effectiveID: selected,
                source: .saved
            )
        }
        if let availableDefault, availableIDs.contains(availableDefault) {
            return EffectiveInputDevice(
                selectedID: selected,
                effectiveID: availableDefault,
                source: .default
            )
        }
        return EffectiveInputDevice(
            selectedID: selected,
            effectiveID: nil,
            source: .unavailable
        )
    }
}
