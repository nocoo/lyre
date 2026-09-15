import ScreenCaptureKit
import Synchronization
import Testing
@testable import Lyre

@MainActor @Suite("ScreenCaptureKit permission probe without system access")
struct ScreenCapturePermissionProbeTests {
    @Test func onlyTheFrameworksExplicitConsentErrorMeansDenied() {
        let code = SCStreamError.userDeclined.rawValue
        #expect(ScreenCapturePermissionProbe.result(for: NSError(domain: SCStreamErrorDomain, code: code)) == .denied)
        let failures = [
            NSError(domain: "AnotherService", code: code),
            NSError(domain: SCStreamErrorDomain, code: -3802),
            CocoaError(.fileReadUnknown) as NSError
        ]
        for error in failures {
            guard case .unavailable = ScreenCapturePermissionProbe.result(for: error) else {
                Issue.record("An unrelated failure must not become a consent denial")
                continue
            }
        }
    }

    @Test(arguments: [ScreenCapturePermissionProbe.Result.granted, .denied])
    func callbackCompletesOnce(_ result: ScreenCapturePermissionProbe.Result) async {
        let actual = await ScreenCapturePermissionProbe.check { completion in
            completion(result)
            completion(result)
        }
        #expect(actual == result)
    }

    @Test func timeoutReleasesTheCallerAndIgnoresALateNativeCallback() async {
        let callback = Mutex<ScreenCapturePermissionProbe.Completion?>(nil)
        let result = await ScreenCapturePermissionProbe.check(timeout: .milliseconds(10)) { completion in
            callback.withLock { $0 = completion }
        }
        guard case .unavailable = result else {
            Issue.record("No callback must time out without claiming permission was denied")
            return
        }
        let lateCallback = callback.withLock { $0 }
        lateCallback?(.granted)
        let retry = await ScreenCapturePermissionProbe.check { $0(.granted) }
        #expect(retry == .granted)
    }

    @Test func cancellationDoesNotWaitForTheNativeCallback() async {
        let started = AsyncStream<Void>.makeStream()
        let task = Task {
            await ScreenCapturePermissionProbe.check(timeout: .seconds(2)) { _ in
                started.continuation.yield(())
                started.continuation.finish()
            }
        }
        for await _ in started.stream {}
        task.cancel()
        #expect(await task.value == .unavailable("Access check cancelled."))
    }

    @Test func anAlreadyCancelledCheckNeverCallsTheFramework() async {
        let queried = Mutex(false)
        let task = Task {
            await ScreenCapturePermissionProbe.check { completion in
                queried.withLock { $0 = true }
                completion(.granted)
            }
        }
        task.cancel()
        #expect(await task.value == .unavailable("Access check cancelled."))
        #expect(!queried.withLock { $0 })
    }
}
