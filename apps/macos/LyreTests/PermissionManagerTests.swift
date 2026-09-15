import AVFoundation
import Testing
@testable import Lyre

@MainActor @Suite("Permission status and explicit consent")
struct PermissionManagerTests {
    @Test func initialStateDoesNotAssumePermission() {
        let manager = PermissionManager()
        #expect(manager.screenRecording == .unknown)
        #expect(manager.microphone == .unknown)
        #expect(manager.needsSetup)
    }

    @Test func recordingCheckRefreshesCachedStatusWithoutRequestingConsent() async {
        let probe = PermissionProbe()
        let manager = probe.manager()
        manager.microphone = .denied
        await manager.checkAll()
        #expect(manager.allGranted)
        #expect(!manager.needsSetup)
        #expect(probe.microphoneRequests == 0)
        #expect(probe.screenRequests == 0)
    }

    @Test func passiveRefreshNeverRequestsUndeterminedPermissions() async {
        let probe = PermissionProbe()
        probe.screen = false
        probe.microphone = .notDetermined
        let manager = probe.manager()
        await manager.checkAll()
        await manager.refreshStatusWithoutPrompt()
        #expect(manager.microphone == .unknown)
        #expect(manager.screenRecording == .unknown)
        #expect(probe.microphoneRequests == 0)
        #expect(probe.screenRequests == 0)
    }

    @Test(arguments: [AVAuthorizationStatus.authorized, .denied, .restricted])
    func alreadyDeterminedMicrophoneDoesNotAskAgain(_ status: AVAuthorizationStatus) async {
        let probe = PermissionProbe()
        probe.microphone = status
        let manager = probe.manager()
        await manager.requestMicrophone()
        #expect(probe.microphoneRequests == 0)
        #expect(manager.microphone == (status == .authorized ? .granted : .denied))
    }

    @Test func explicitMicrophoneRequestIsCoalescedAndNotRepeated() async {
        let probe = PermissionProbe()
        probe.microphone = .notDetermined
        let manager = probe.manager()
        async let first: Void = manager.requestMicrophone()
        async let second: Void = manager.requestMicrophone()
        _ = await (first, second)
        await manager.requestMicrophone()
        #expect(probe.microphoneRequests == 1)
        #expect(manager.microphone == .granted)
        #expect(!manager.isRequestingMicrophone)
    }

    @Test func externalGrantAndRevocationRefreshBothDirections() async {
        let probe = PermissionProbe()
        probe.microphone = .denied
        let manager = probe.manager()
        await manager.checkAll()
        #expect(!manager.allGranted)
        probe.microphone = .authorized
        await manager.refreshStatusWithoutPrompt()
        #expect(manager.allGranted)
        probe.screen = false
        await manager.checkAll()
        #expect(manager.screenRecording == .denied)
        #expect(manager.microphone == .granted)
        #expect(!manager.allGranted)
    }

    @Test func explicitScreenRequestIsSeparateFromStatusChecks() async {
        let probe = PermissionProbe()
        probe.screen = false
        let manager = probe.manager()
        await manager.checkAll()
        #expect(probe.screenRequests == 0)
        await manager.requestScreenRecording()
        await manager.requestScreenRecording()
        #expect(probe.screenRequests == 1)
        #expect(manager.screenRecording == .granted)
    }
}

@MainActor private final class PermissionProbe {
    var screen = true
    var microphone = AVAuthorizationStatus.authorized
    var microphoneRequests = 0
    var screenRequests = 0

    func manager() -> PermissionManager {
        PermissionManager(
            screenAccess: { self.screen },
            microphoneStatus: { self.microphone },
            askForMicrophone: {
                self.microphoneRequests += 1
                await Task.yield()
                self.microphone = .authorized
                return true
            },
            askForScreenAccess: {
                self.screenRequests += 1
                self.screen = true
                return true
            }
        )
    }
}
