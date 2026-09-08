import Foundation
import Testing
@testable import Lyre

@Suite("Native test isolation")
struct NativeTestPolicyTests {
    @Test @MainActor func hostedTestsUseEmptyApplication() {
        let environment = ProcessInfo.processInfo.environment
        #expect(NativeTestPolicy.emptyHostStarted)
        #expect(environment["LYRE_TEST_HOST"] == "1")
        #expect(["0", "1"].contains(environment["LYRE_RUN_LIVE_RECORDING"] ?? ""))
        let recording = environment["LYRE_RUN_LIVE_RECORDING"] ?? "missing"
        print("[Native test host] empty application; live recording = \(recording)")
    }

    @Test func ordinaryApplicationDoesNotUseTestHost() {
        #expect(!NativeTestPolicy.isTestHost(environment: [:]))
        #expect(!NativeTestPolicy.isTestHost(environment: ["LYRE_TEST_HOST": "true"]))
        #expect(NativeTestPolicy.isTestHost(environment: ["LYRE_TEST_HOST": "1"]))
        let hosted = ["XCTestConfigurationFilePath": "/tmp/test.xctestconfiguration"]
        #expect(NativeTestPolicy.isTestHost(environment: hosted))
    }

    @Test(arguments: ["", "0", "true", "yes"])
    func disabledRecordingDoesNotProbePermissions(value: String) async {
        var calls = 0
        await #expect(throws: NativeTestPolicy.LiveRecordingError.notEnabled) {
            try await NativeTestPolicy.requireLiveRecording(environment: ["LYRE_RUN_LIVE_RECORDING": value]) {
                calls += 1
                return true
            }
        }
        #expect(calls == 0)
    }

    @Test func missingOptInDoesNotProbePermissions() async {
        var calls = 0
        await #expect(throws: NativeTestPolicy.LiveRecordingError.notEnabled) {
            try await NativeTestPolicy.requireLiveRecording(environment: [:]) {
                calls += 1
                return true
            }
        }
        #expect(calls == 0)
    }

    @Test func optedInRecordingRequiresExistingPermissions() async {
        var calls = 0
        await #expect(throws: NativeTestPolicy.LiveRecordingError.permissionsUnavailable) {
            try await NativeTestPolicy.requireLiveRecording(environment: ["LYRE_RUN_LIVE_RECORDING": "1"]) {
                calls += 1
                return false
            }
        }
        #expect(calls == 1)
    }

    @Test func optedInRecordingAcceptsPermissionFixture() async throws {
        var calls = 0
        try await NativeTestPolicy.requireLiveRecording(environment: ["LYRE_RUN_LIVE_RECORDING": "1"]) {
            calls += 1
            return true
        }
        #expect(calls == 1)
    }
}
