// swiftlint:disable file_length
import Foundation
import Testing
@testable import Lyre

/// Unit tests for `RecordingActionController`. The controller is the single
/// entry point that both the tray menu and the meeting prompt coordinator
/// use to start/stop a recording; these tests verify the side-effect surface
/// (elapsed timer lifecycle, `RecordingsStore.refresh(url:)` invocation, error
/// alert dispatch, and the guard against double-start / stop-when-idle).
///
/// All fakes conform to the narrow protocols defined in
/// `Recording/RecordingActionSeams.swift` and `Meeting/AlertPresenter.swift`,
/// so no `RecordingManager` / `RecordingsStore` subclassing is required.
@MainActor
@Suite("RecordingActionController Tests")
struct RecordingActionControllerTests {
    @Test func requestStart_success_startsRecordingAndArmsElapsed() async throws {
        let recorder = FakeRecorder()
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStart()

        #expect(recorder.startCount == 1)
        #expect(recorder.state == .recording)
        #expect(controller.elapsedDisplay == "00:00")
        #expect(alerts.errorCount == 0)
    }

    @Test func requestStart_whenAlreadyRecording_isNoOp() async {
        let recorder = FakeRecorder()
        recorder.state = .recording
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStart()

        #expect(recorder.startCount == 0)  // guarded out — no double start
        #expect(alerts.errorCount == 0)
    }

    @Test func requestStart_failure_surfacesAlertAndSkipsElapsed() async {
        let recorder = FakeRecorder()
        recorder.startShouldThrow = FakeError.simulated("start blew up")
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStart()

        #expect(recorder.startCount == 1)
        #expect(alerts.errorCount == 1)
        #expect(alerts.lastErrorTitle == "Recording Failed")
        #expect(alerts.lastErrorMessage.contains("start blew up"))
        #expect(controller.elapsedDisplay == "00:00")
    }

    @Test func requestStop_success_refreshesStoreAndResetsElapsed() async throws {
        let recorder = FakeRecorder()
        recorder.state = .recording
        let expectedURL = URL(fileURLWithPath: "/tmp/lyre-test.m4a")
        recorder.stopURL = expectedURL
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        #expect(recorder.stopCount == 1)
        #expect(store.refreshCount == 1)
        #expect(store.lastRefreshURL == expectedURL)
        #expect(controller.elapsedDisplay == "00:00")
        #expect(alerts.errorCount == 0)
    }

    @Test func requestStop_whenIdle_isNoOp() async {
        let recorder = FakeRecorder()  // state = .idle by default
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        #expect(recorder.stopCount == 0)
        #expect(store.refreshCount == 0)
        #expect(alerts.errorCount == 0)
    }

    @Test func requestStop_failure_surfacesAlertAndSkipsRefresh() async {
        let recorder = FakeRecorder()
        recorder.state = .recording
        recorder.stopShouldThrow = FakeError.simulated("finalize failed")
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        #expect(recorder.stopCount == 1)
        #expect(store.refreshCount == 0)
        #expect(alerts.errorCount == 1)
        #expect(alerts.lastErrorTitle == "Recording Error")
        #expect(alerts.lastErrorMessage.contains("finalize failed"))
    }

    @Test func setRecordingsStore_redirectsPostStopRefreshToNewStore() async {
        // Regression for C4 Reviewer finding #1: swapping the RecordingsStore
        // (e.g. output-directory change) must reroute the post-stop refresh,
        // not silently keep pointing at the stale store.
        let recorder = FakeRecorder()
        recorder.state = .recording
        let firstStore = FakeRecordingsStore()
        let secondStore = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: firstStore,
            alertPresenter: alerts
        )

        controller.setRecordingsStore(secondStore)
        await controller.requestStop()

        #expect(firstStore.refreshCount == 0)   // stale store not touched
        #expect(secondStore.refreshCount == 1)  // new store received the file
    }

    @Test func state_reflectsLifecycleTransitions() async {
        // Regression for C4 Reviewer finding #2: SwiftUI observation depends
        // on the controller's own stored `state`, not a computed proxy over
        // the underlying recorder.
        let recorder = FakeRecorder()  // starts .idle
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        #expect(controller.state == .idle)

        await controller.requestStart()
        #expect(controller.state == .recording)

        await controller.requestStop()
        #expect(controller.state == .idle)
    }

    @Test func state_reflectsRecorderStateAtInit() {
        // If Lyre restarts while the recorder is already recording (a rare
        // but possible reconstruction path), the controller must seed from
        // the recorder rather than defaulting to `.idle`.
        let recorder = FakeRecorder()
        recorder.state = .recording
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        #expect(controller.state == .recording)
    }

    // MARK: - Non-fatal mic silence warning surface

    @Test func requestStop_micSilenceDiagnostic_surfacesWarningAfterHealthyStop() async {
        // Precondition: stopRecording succeeds (fileURL returned, store
        // refreshed) — the warning must not gate any of that.
        let recorder = FakeRecorder()
        recorder.state = .recording
        let expectedURL = URL(fileURLWithPath: "/tmp/lyre-mic-silence.m4a")
        recorder.stopURL = expectedURL
        recorder.lastCaptureDiagnostics = CaptureDiagnostics(
            micBufferCount: 0,
            systemAudioBufferCount: 800,
            elapsedMs: 12_000,
            captureMicrophone: true,
            effectiveDeviceID: "AirPods-uid"
        )
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        // Stop-success invariants — unchanged by warning.
        #expect(recorder.stopCount == 1)
        #expect(store.refreshCount == 1)
        #expect(store.lastRefreshURL == expectedURL)
        #expect(controller.state == .idle)

        // Warning surface.
        #expect(alerts.errorCount == 1)
        #expect(alerts.lastErrorTitle == "Microphone Not Captured")
        #expect(alerts.lastErrorMessage.contains("AirPods-uid"))
    }

    @Test func requestStop_healthyDiagnostic_doesNotWarn() async {
        let recorder = FakeRecorder()
        recorder.state = .recording
        recorder.lastCaptureDiagnostics = CaptureDiagnostics(
            micBufferCount: 900,
            systemAudioBufferCount: 800,
            elapsedMs: 12_000,
            captureMicrophone: true,
            effectiveDeviceID: "built-in-uid"
        )
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        #expect(store.refreshCount == 1)
        #expect(alerts.errorCount == 0)
    }

    @Test func requestStop_shortSession_suppressesMicSilenceWarning() async {
        // Sub-threshold elapsed => cold-start latency dominates; the
        // warning is (correctly) suppressed even though mic=0.
        let recorder = FakeRecorder()
        recorder.state = .recording
        recorder.lastCaptureDiagnostics = CaptureDiagnostics(
            micBufferCount: 0,
            systemAudioBufferCount: 100,
            elapsedMs: 2_000,
            captureMicrophone: true,
            effectiveDeviceID: "built-in-uid"
        )
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        #expect(store.refreshCount == 1)
        #expect(alerts.errorCount == 0)
    }

    @Test func requestStop_failure_doesNotEmitMicSilenceWarning() async {
        // Even if diagnostics were populated pre-throw, a hard failure
        // takes the error path and shows the "Recording Error" alert.
        // The mic-silence warning must not double up on top of it.
        let recorder = FakeRecorder()
        recorder.state = .recording
        recorder.stopShouldThrow = FakeError.simulated("finalize failed")
        recorder.lastCaptureDiagnostics = CaptureDiagnostics(
            micBufferCount: 0,
            systemAudioBufferCount: 800,
            elapsedMs: 12_000,
            captureMicrophone: true,
            effectiveDeviceID: "AirPods-uid"
        )
        let store = FakeRecordingsStore()
        let alerts = FakeAlertPresenter()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: store,
            alertPresenter: alerts
        )

        await controller.requestStop()

        #expect(alerts.errorCount == 1)
        #expect(alerts.lastErrorTitle == "Recording Error")
        #expect(alerts.lastErrorMessage.contains("finalize failed"))
    }

    @Test func recorderStateDivergesToIdle_elapsedTick_convergesControllerState() async {
        // Regression: RecordingManager.handleStreamError() flips its own
        // `state` to `.idle` bypassing the controller. Before this fix the
        // controller stayed `.recording` (tray menu showed "Stop Recording"
        // while the tray icon — reading recorder.state — showed idle).
        // The elapsed-timer tick now mirrors the recovery.
        let recorder = FakeRecorder()
        let controller = RecordingActionController(
            recorder: recorder,
            recordingsStore: FakeRecordingsStore(),
            alertPresenter: FakeAlertPresenter()
        )
        await controller.requestStart()
        #expect(controller.state == .recording)
        recorder.state = .idle
        controller.testingForceElapsedTick()
        #expect(controller.state == .idle)
        #expect(controller.elapsedDisplay == "00:00")
    }
}

// MARK: - Fakes

@MainActor
private final class FakeRecorder: RecordingLifecycleManaging {
    var state: RecordingManager.State = .idle
    var elapsedSeconds: TimeInterval = 0
    var startCount = 0
    var stopCount = 0
    var stopURL = URL(fileURLWithPath: "/tmp/fake-recording.m4a")
    var startShouldThrow: Error?
    var stopShouldThrow: Error?
    /// Snapshot the controller reads after a successful stop to decide
    /// whether to raise a non-fatal warning. Default `nil` keeps the
    /// pre-existing tests exercising the healthy stop path.
    var lastCaptureDiagnostics: CaptureDiagnostics?

    func startRecording() async throws {
        startCount += 1
        if let err = startShouldThrow { throw err }
        state = .recording
    }

    @discardableResult
    func stopRecording() async throws -> URL {
        stopCount += 1
        if let err = stopShouldThrow { throw err }
        state = .idle
        return stopURL
    }
}

@MainActor
private final class FakeRecordingsStore: RecordingsRefreshing {
    var refreshCount = 0
    var lastRefreshURL: URL?

    func refresh(url: URL) async {
        refreshCount += 1
        lastRefreshURL = url
    }
}

@MainActor
private final class FakeAlertPresenter: AlertPresenting {
    var choiceCount = 0
    var errorCount = 0
    var lastErrorTitle = ""
    var lastErrorMessage = ""
    /// Return value for the next `presentChoice` call.
    var choiceReturn: Bool = false

    func presentChoice(
        title: String,
        message: String,
        primary: String,
        secondary: String
    ) -> Bool {
        choiceCount += 1
        return choiceReturn
    }

    func presentError(title: String, message: String) {
        errorCount += 1
        lastErrorTitle = title
        lastErrorMessage = message
    }
}

private enum FakeError: LocalizedError {
    case simulated(String)

    var errorDescription: String? {
        switch self {
        case .simulated(let detail): return detail
        }
    }
}
// swiftlint:enable file_length
