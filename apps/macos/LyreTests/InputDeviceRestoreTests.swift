import Testing
import CoreMedia
import Foundation
@testable import Lyre

@Suite("InputDeviceRestore Tests")
struct InputDeviceRestoreTests {
    private struct ConfigContext {
        let config: AppConfig
        let dir: URL

        func cleanup() {
            try? FileManager.default.removeItem(at: dir)
        }
    }

    private func makeConfig(savedID: String? = nil) -> ConfigContext {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-restore-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let cfg = AppConfig(configURL: configURL)
        cfg.selectedInputDeviceID = savedID
        return ConfigContext(config: cfg, dir: tempDir)
    }

    @Test func noSavedIDLeavesCaptureAlone() {
        let ctx = makeConfig()
        defer { ctx.cleanup() }

        let capture = RestoreFakeCapture()
        capture.availableDevices = [AudioInputDevice(id: "built-in", name: "Built-in")]

        let outcome = InputDeviceRestore.restore(config: ctx.config, capture: capture)

        #expect(outcome == .noSavedID)
        #expect(capture.selectedDeviceID == nil)
        #expect(ctx.config.selectedInputDeviceID == nil)
        #expect(capture.refreshCount == 1)
    }

    @Test func savedIDStillAvailableIsRestored() {
        let ctx = makeConfig(savedID: "usb-mic")
        defer { ctx.cleanup() }

        let capture = RestoreFakeCapture()
        capture.availableDevices = [
            AudioInputDevice(id: "built-in", name: "Built-in"),
            AudioInputDevice(id: "usb-mic", name: "USB Mic")
        ]

        let outcome = InputDeviceRestore.restore(config: ctx.config, capture: capture)

        #expect(outcome == .restored("usb-mic"))
        #expect(capture.selectedDeviceID == "usb-mic")
        #expect(ctx.config.selectedInputDeviceID == "usb-mic")
        #expect(capture.refreshCount == 1)
    }

    @Test func savedIDMissingClearsConfigAndCapture() {
        let ctx = makeConfig(savedID: "ghost-mic")
        defer { ctx.cleanup() }

        let capture = RestoreFakeCapture()
        capture.availableDevices = [AudioInputDevice(id: "built-in", name: "Built-in")]

        let outcome = InputDeviceRestore.restore(config: ctx.config, capture: capture)

        #expect(outcome == .clearedStale("ghost-mic"))
        #expect(capture.selectedDeviceID == nil)
        #expect(ctx.config.selectedInputDeviceID == nil)
        #expect(capture.refreshCount == 1)
    }

    @Test func savedIDMissingWithNoAvailableDevicesStillClears() {
        // Headless / CI: enumeration returns no devices.
        let ctx = makeConfig(savedID: "old-usb")
        defer { ctx.cleanup() }

        let capture = RestoreFakeCapture()
        capture.availableDevices = []

        let outcome = InputDeviceRestore.restore(config: ctx.config, capture: capture)

        #expect(outcome == .clearedStale("old-usb"))
        #expect(ctx.config.selectedInputDeviceID == nil)
        #expect(capture.selectedDeviceID == nil)
    }
}

// MARK: - Test double

/// Minimal AudioCapturing stub for restore tests. Not shared with the
/// RecordingManager suite's FakeCapture because that one is fileprivate
/// there and grew richer counters we don't need here.
private final class RestoreFakeCapture: AudioCapturing, @unchecked Sendable {
    var availableDevices: [AudioInputDevice] = []
    var selectedDeviceID: String?
    var lastCaptureDiagnostics: CaptureDiagnostics?
    var onMixedSamples: (([Float]) -> Void)?
    var onRawSystemBuffer: ((CMSampleBuffer) -> Void)?
    var onRawMicBuffer: ((CMSampleBuffer) -> Void)?
    var onStreamError: ((Error) -> Void)?

    var refreshCount = 0

    func refreshDevices() { refreshCount += 1 }
    func startCapture() async throws {}
    func stopCapture() async throws {}
}
