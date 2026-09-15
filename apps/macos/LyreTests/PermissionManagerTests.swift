import AVFoundation
import ScreenCaptureKit
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

    @Test func actualGrantOverridesAFalsePreflightAcrossPassiveRefreshes() async throws {
        let probe = PermissionProbe()
        probe.screen = false
        let manager = probe.manager()
        try await manager.prepareForRecording()
        #expect(manager.allGranted)
        #expect(probe.screenRequests == 1)
        await manager.checkAll()
        await manager.handleApplicationActivation()
        try await manager.prepareForRecording()
        #expect(manager.allGranted)
        #expect(probe.screenRequests == 1)
        #expect(!probe.screen, "A successful capture check must not depend on CG updating its cache")
    }

    @Test func actualDenialOverridesAStalePositivePreflightUntilRechecked() async {
        let probe = PermissionProbe()
        probe.screenResult = .denied
        let manager = probe.manager()
        await manager.checkAll()
        #expect(manager.allGranted)
        await manager.verifyRecordingAccess()
        await manager.checkAll()
        #expect(manager.screenRecording == .denied)
        #expect(!manager.allGranted)
        probe.screenResult = .granted
        await manager.verifyRecordingAccess()
        #expect(manager.allGranted)
    }

    @Test func transientFailureDoesNotClaimThatPermissionWasDenied() async throws {
        let probe = PermissionProbe()
        probe.screen = false
        probe.screenResult = .unavailable("Service temporarily unavailable")
        let manager = probe.manager()
        await #expect(throws: PermissionManager.VerificationError.self) {
            try await manager.prepareForRecording()
        }
        #expect(manager.screenRecording == .unknown)
        #expect(manager.screenRecordingIssue == "Service temporarily unavailable")
        #expect(!manager.isRequestingScreenRecording)

        probe.screenResult = .granted
        await manager.verifyRecordingAccess()
        #expect(manager.screenRecordingIssue == nil)
        probe.screenResult = .unavailable("Service temporarily unavailable")
        await manager.verifyRecordingAccess()
        #expect(manager.screenRecording == .granted)
    }

    @Test func deniedMicrophoneDoesNotTriggerAScreenRequestWhenRecording() async throws {
        let probe = PermissionProbe()
        probe.screen = false
        probe.microphone = .denied
        let manager = probe.manager()
        try await manager.prepareForRecording()
        #expect(manager.needsSetup)
        #expect(probe.screenRequests == 0)
        #expect(probe.microphoneRequests == 0)
    }

    @Test func onlyReturningFromOurSettingsActionPerformsAnInteractiveCheck() async {
        let probe = PermissionProbe()
        probe.screen = false
        let manager = probe.manager()
        await manager.handleApplicationActivation()
        #expect(probe.screenRequests == 0)
        manager.openScreenRecordingSettings()
        #expect(probe.settingsRequests == 1)
        await manager.handleApplicationActivation()
        #expect(manager.allGranted)
        #expect(probe.screenRequests == 1)
        await manager.handleApplicationActivation()
        #expect(probe.screenRequests == 1)
    }

    @Test func simultaneousExplicitChecksShareOneFrameworkRequest() async {
        let probe = PermissionProbe()
        probe.holdScreenRequest = true
        let manager = probe.manager()
        let first = Task { await manager.verifyRecordingAccess() }
        await waitUntil { probe.pendingScreenRequest != nil }
        var secondStarted = false
        let second = Task {
            secondStarted = true
            await manager.verifyRecordingAccess()
        }
        await waitUntil { secondStarted }
        #expect(manager.isRequestingScreenRecording)
        #expect(probe.screenRequests == 1)
        probe.resolveScreenRequest(.granted)
        await first.value
        await second.value
        #expect(manager.allGranted)
        #expect(probe.screenRequests == 1)
        #expect(!manager.isRequestingScreenRecording)
    }

    @Test func lateSuccessCannotUndoARealCaptureDenial() async {
        let probe = PermissionProbe()
        let manager = probe.manager()
        await manager.verifyRecordingAccess()
        manager.reportScreenCaptureFailure(CocoaError(.fileReadUnknown))
        #expect(manager.screenRecording == .granted)

        probe.holdScreenRequest = true
        let pending = Task { await manager.verifyRecordingAccess() }
        await waitUntil { probe.pendingScreenRequest != nil }
        manager.reportScreenCaptureFailure(NSError(
            domain: SCStreamErrorDomain, code: SCStreamError.userDeclined.rawValue
        ))
        #expect(manager.screenRecording == .denied)
        probe.resolveScreenRequest(.granted)
        await pending.value
        await manager.checkAll()
        #expect(manager.screenRecording == .denied)
        #expect(!manager.isRequestingScreenRecording)
        await manager.verifyRecordingAccess()
        #expect(manager.allGranted)
    }
}

@MainActor private final class PermissionProbe {
    var screen = true
    var microphone = AVAuthorizationStatus.authorized
    var microphoneRequests = 0
    var screenRequests = 0
    var settingsRequests = 0
    var screenResult = ScreenCapturePermissionProbe.Result.granted
    var holdScreenRequest = false
    var pendingScreenRequest: CheckedContinuation<ScreenCapturePermissionProbe.Result, Never>?

    func resolveScreenRequest(_ result: ScreenCapturePermissionProbe.Result) {
        holdScreenRequest = false
        let pending = pendingScreenRequest
        pendingScreenRequest = nil
        pending?.resume(returning: result)
    }

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
            screenCaptureProbe: {
                self.screenRequests += 1
                if self.holdScreenRequest {
                    return await withCheckedContinuation { self.pendingScreenRequest = $0 }
                }
                return self.screenResult
            },
            openSystemSettings: { _ in self.settingsRequests += 1 }
        )
    }
}

@MainActor private func waitUntil(_ predicate: () -> Bool) async {
    let deadline = ContinuousClock.now + .seconds(2)
    while !predicate() && ContinuousClock.now < deadline { await Task.yield() }
    #expect(predicate())
}
