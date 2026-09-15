import Testing
@testable import Lyre

@Suite("Input device resolution")
struct InputDeviceResolverTests {
    @Test func connectedSelectionWinsOverSystemDefault() {
        let route = InputDeviceResolver.resolve(
            selected: "usb", availableDefault: "built-in", availableIDs: ["usb", "built-in"]
        )
        #expect(route == EffectiveInputDevice(selectedID: "usb", effectiveID: "usb", source: .saved))
    }

    @Test func disconnectedSelectionUsesDefaultAndReconnectsWithoutLosingPreference() {
        let fallback = InputDeviceResolver.resolve(
            selected: "usb", availableDefault: "built-in", availableIDs: ["built-in"]
        )
        #expect(fallback == EffectiveInputDevice(selectedID: "usb", effectiveID: "built-in", source: .default))
        let reconnected = InputDeviceResolver.resolve(
            selected: fallback.selectedID, availableDefault: "built-in", availableIDs: ["usb", "built-in"]
        )
        #expect(reconnected.effectiveID == "usb")
        #expect(reconnected.source == .saved)
    }

    @Test func automaticFollowsDefaultWithoutSavingIt() {
        for device in ["built-in", "headset"] {
            let route = InputDeviceResolver.resolve(
                selected: nil, availableDefault: device, availableIDs: ["built-in", "headset"]
            )
            #expect(route.selectedID == nil)
            #expect(route.effectiveID == device)
            #expect(route.source == .default)
        }
    }

    @Test func unavailableDefaultIsNeverPassedToScreenCaptureKit() {
        let route = InputDeviceResolver.resolve(
            selected: "usb", availableDefault: "disconnected", availableIDs: ["built-in"]
        )
        #expect(route.selectedID == "usb")
        #expect(route.effectiveID == nil)
        #expect(route.source == .unavailable)
    }

    @Test func savedInputStillWorksWithoutSystemDefault() {
        let route = InputDeviceResolver.resolve(selected: "usb", availableDefault: nil, availableIDs: ["usb"])
        #expect(route.effectiveID == "usb")
        #expect(route.source == .saved)
    }

    @Test func noInputsDoesNotDelegateAnUnknownDefaultToSCK() {
        let route = InputDeviceResolver.resolve(selected: nil, availableDefault: nil, availableIDs: [])
        #expect(route.effectiveID == nil)
        #expect(route.source == .unavailable)
    }
}
