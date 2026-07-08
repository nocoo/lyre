import Testing
@testable import Lyre

@Suite("InputDeviceResolver Tests")
struct InputDeviceResolverTests {
    @Test func savedSelectionWinsOverSystemDefault() {
        let out = InputDeviceResolver.resolve(
            selected: "usb-mic",
            availableDefault: "built-in"
        )
        #expect(out.selectedID == "usb-mic")
        #expect(out.effectiveID == "usb-mic")
        #expect(out.source == .saved)
    }

    @Test func savedSelectionUsedEvenWhenSystemDefaultMissing() {
        // We do not verify the saved id against the device list here —
        // that is InputDeviceRestore's job at startup. The resolver's
        // contract is "if the user asked for X, ask SCK for X".
        let out = InputDeviceResolver.resolve(
            selected: "usb-mic",
            availableDefault: nil
        )
        #expect(out.effectiveID == "usb-mic")
        #expect(out.source == .saved)
    }

    @Test func nilSelectionResolvesToSystemDefaultAndDoesNotWriteBack() {
        let out = InputDeviceResolver.resolve(
            selected: nil,
            availableDefault: "built-in"
        )
        #expect(out.selectedID == nil, "auto stays auto — must not be written back to config")
        #expect(out.effectiveID == "built-in")
        #expect(out.source == .default)
    }

    @Test func nilSelectionWithNoSystemDefaultFallsThroughToSCK() {
        let out = InputDeviceResolver.resolve(
            selected: nil,
            availableDefault: nil
        )
        #expect(out.selectedID == nil)
        #expect(out.effectiveID == nil, "no UID to hand SCK; caller must not set microphoneCaptureDeviceID")
        #expect(out.source == .scPicked)
    }

    @Test func selectedIDNotReplacedByDifferentDefault() {
        // Regression: earlier draft accidentally overrode saved with
        // default when the two disagreed.
        let out = InputDeviceResolver.resolve(
            selected: "usb-mic",
            availableDefault: "built-in"
        )
        #expect(out.effectiveID == "usb-mic")
        #expect(out.effectiveID != "built-in")
    }
}
