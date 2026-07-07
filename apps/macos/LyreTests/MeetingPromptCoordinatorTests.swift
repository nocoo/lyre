import Foundation
import Testing
@testable import Lyre

// State-machine tests for MeetingPromptCoordinator. All fakes go through the
// protocol seams so no NSAlert is ever presented and no real watcher is
// spun up.

@MainActor
@Suite("MeetingPromptCoordinator Tests")
struct MeetingPromptCoordinatorTests {
    // MARK: - Start-prompt gating

    @Test func startEvent_whenIdle_presentsStartPromptAndForwards() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .idle
        ctx.alerts.choiceReturn = true

        await coord.handle(active: true)

        #expect(ctx.alerts.choiceCount == 1)
        #expect(ctx.alerts.lastChoicePrimary == "Start Recording")
        #expect(ctx.action.startCount == 1)
    }

    @Test func startEvent_whenIdle_userDeclines_noStartCall() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .idle
        ctx.alerts.choiceReturn = false

        await coord.handle(active: true)

        #expect(ctx.alerts.choiceCount == 1)
        #expect(ctx.action.startCount == 0)
    }

    @Test func startEvent_whenRecording_isNoOp() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .recording  // user already recording (manual start)

        await coord.handle(active: true)

        #expect(ctx.alerts.choiceCount == 0)
        #expect(ctx.action.startCount == 0)
    }

    // MARK: - Stop-prompt gating

    @Test func endEvent_whenRecording_presentsStopPromptAndForwards() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .recording
        ctx.alerts.choiceReturn = true

        await coord.handle(active: false)

        #expect(ctx.alerts.choiceCount == 1)
        #expect(ctx.alerts.lastChoicePrimary == "Stop Recording")
        #expect(ctx.action.stopCount == 1)
    }

    @Test func endEvent_whenIdle_isNoOp() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .idle  // user wasn't recording anyway

        await coord.handle(active: false)

        #expect(ctx.alerts.choiceCount == 0)
        #expect(ctx.action.stopCount == 0)
    }

    // MARK: - Per-meeting suppression

    @Test func perMeeting_secondStartWithinSameMeeting_isSuppressed() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .idle
        ctx.alerts.choiceReturn = false  // user hit "Not now"

        await coord.handle(active: true)   // prompt #1
        await coord.handle(active: true)   // still same "meeting" — must not re-prompt

        #expect(ctx.alerts.choiceCount == 1)
    }

    @Test func perMeeting_stopSuppressedInSameMeeting() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .recording
        ctx.alerts.choiceReturn = false  // user hit "Keep Recording"

        await coord.handle(active: false)  // stop prompt #1
        await coord.handle(active: false)  // must not re-prompt in same cycle

        #expect(ctx.alerts.choiceCount == 1)
    }

    @Test func newMeetingCycle_afterFalseTransition_allowsFreshStartPrompt() async {
        let (coord, ctx) = makeCoordinator()
        ctx.action.state = .idle
        ctx.alerts.choiceReturn = false

        await coord.handle(active: true)   // meeting #1 start prompt
        await coord.handle(active: false)  // meeting #1 ends (idle → no stop prompt)
        await coord.handle(active: true)   // meeting #2 start prompt — allowed again

        #expect(ctx.alerts.choiceCount == 2)
    }

    // MARK: - Off-switch

    @Test func settingsDisabled_swallowsEvents() async {
        let (coord, ctx) = makeCoordinator()
        ctx.settings.isEnabled = false
        ctx.action.state = .idle

        await coord.handle(active: true)
        await coord.handle(active: false)

        #expect(ctx.alerts.choiceCount == 0)
        #expect(ctx.action.startCount == 0)
        #expect(ctx.action.stopCount == 0)
    }

    // MARK: - Single-alert reentrance

    @Test func singleAlert_secondEventDuringPromptIsDropped() async {
        // Regression for the reentrance rule: if an alert is currently on
        // screen, a fresh event that arrives before the modal returns must
        // be dropped, not queued. We simulate that by using an alert double
        // that lets us fire a second `handle(...)` from *inside* the
        // presenter closure.
        let ctx = makeContext()
        ctx.action.state = .idle

        let coord = MeetingPromptCoordinator(
            watcher: ctx.watcher,
            action: ctx.action,
            alertPresenter: ctx.alerts,
            settings: ctx.settings
        )
        var recursivePromptCount = 0
        ctx.alerts.onBeforePresentChoice = {
            // Fire a second event while the alert is "up". If reentrance
            // is not gated, this recursive `handle` would count as a
            // second prompt. Guard against infinite loops with a counter.
            guard recursivePromptCount == 0 else { return }
            recursivePromptCount += 1
            Task { @MainActor in await coord.handle(active: false) }
        }
        ctx.alerts.choiceReturn = false

        await coord.handle(active: true)  // outer prompt

        // Give the reentrant Task a chance to run. It should observe the
        // `isPromptPresented` guard and take no action.
        try? await Task.sleep(nanoseconds: 20_000_000)  // 20ms

        #expect(ctx.alerts.choiceCount == 1)
        #expect(ctx.action.stopCount == 0)
    }

    // MARK: - DQ-8: buffered stream events during modal

    @Test func streamLevel_meetingEndedDuringStartPrompt_isDropped() async {
        // DQ-8 regression: while the Start prompt is on screen, the watcher
        // yields a `false` (meeting ended). The consumer must not deliver
        // that buffered `false` to the coordinator once the Start prompt
        // returns — otherwise the coordinator would immediately follow up
        // with a Stop prompt ("close one, another appears"). Contract in
        // docs/07-teams-meeting-detector.md DQ-8.
        let ctx = makeContext()
        ctx.action.state = .idle
        ctx.alerts.choiceReturn = true  // user accepts Start → will start recording

        let coord = MeetingPromptCoordinator(
            watcher: ctx.watcher,
            action: ctx.action,
            alertPresenter: ctx.alerts,
            settings: ctx.settings
        )
        // From inside the modal, feed a meeting-ended event through the
        // real AsyncStream path. This is the scenario that the direct-
        // reentrance test cannot exercise: the buffered `false` would
        // arrive after the modal returns unless the coordinator's gate
        // is observable at stream-consumption time (not just inside a
        // recursive `handle` call).
        ctx.alerts.onBeforePresentChoice = { [ctx] in
            ctx.watcher.feed(false)
        }

        coord.start()
        // Kick off the meeting-started event and wait for the coordinator to
        // finish handling both events (Start prompt accepted + Stop
        // suppression check). Polling rather than a fixed sleep avoids
        // flakiness when the machine is under load — the run-time is
        // deterministic on quiet hardware (~110 ms) but climbs above the
        // old 100 ms budget during a full pre-push pipeline. See DQ-9.
        ctx.watcher.feed(true)
        await waitUntil(timeoutMs: 2_000) { ctx.action.startCount == 1 }
        // Give the consumer one more scheduling turn so any buffered
        // `false` yielded via `onBeforePresentChoice` is drained and
        // observed by the reentrance gate before assertions.
        await Task.yield()
        try? await Task.sleep(nanoseconds: 20_000_000)  // 20ms drain

        #expect(ctx.alerts.choiceCount == 1)
        // startCount == 1 confirms Start prompt was accepted and dispatched.
        #expect(ctx.action.startCount == 1)
        // The critical assertion: no follow-up Stop prompt / stop call.
        #expect(ctx.action.stopCount == 0)

        coord.stop()
    }

    @Test func streamLevel_droppedFalseDuringPrompt_stillArmsNextMeetingCycle() async {
        // Regression: an event that gets dropped by the reentrance gate
        // must still update `lastObservedActive` so the next real
        // `false → true` transition is recognised as a NEW meeting cycle
        // and the Start prompt can fire again. Otherwise the coordinator
        // silently mutes itself for every subsequent meeting after any
        // busy prompt cycle. Contract in docs/07-teams-meeting-detector.md
        // (per-meeting suppression + DQ interaction).
        let ctx = makeContext()
        ctx.action.state = .idle
        ctx.alerts.choiceReturn = false  // user hits "Not now" both times

        let coord = MeetingPromptCoordinator(
            watcher: ctx.watcher,
            action: ctx.action,
            alertPresenter: ctx.alerts,
            settings: ctx.settings
        )

        // First meeting: feed `false` from inside the Start prompt so it
        // gets swallowed by the reentrance gate. Once armed, we clear the
        // hook so the second meeting's Start prompt does not re-feed.
        var didFeedFalse = false
        ctx.alerts.onBeforePresentChoice = { [ctx] in
            guard !didFeedFalse else { return }
            didFeedFalse = true
            ctx.watcher.feed(false)
        }

        coord.start()
        ctx.watcher.feed(true)                              // meeting #1 → Start prompt
        await waitUntil(timeoutMs: 2_000) { ctx.alerts.choiceCount == 1 }
        await Task.yield()
        try? await Task.sleep(nanoseconds: 20_000_000)      // drain the dropped `false`
        ctx.watcher.feed(true)                              // meeting #2 → must re-fire
        await waitUntil(timeoutMs: 2_000) { ctx.alerts.choiceCount == 2 }

        #expect(ctx.alerts.choiceCount == 2)  // both meetings prompted
        #expect(ctx.action.startCount == 0)   // user declined both times
        #expect(ctx.action.stopCount == 0)    // no stop prompts issued

        coord.stop()
    }
}

// MARK: - Test context

@MainActor
private final class TestContext {
    let watcher: FakeMeetingEventProvider
    let action: FakeAction
    let alerts: FakeAlertPresenter
    let settings: MeetingDetectionSettings

    init() {
        self.watcher = FakeMeetingEventProvider()
        self.action = FakeAction()
        self.alerts = FakeAlertPresenter()
        // Isolated defaults so the toggle does not touch the real app.
        let suiteName = "MeetingPromptCoordinatorTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        self.settings = MeetingDetectionSettings(defaults: defaults)
    }
}

@MainActor
private func makeContext() -> TestContext { TestContext() }

@MainActor
private func makeCoordinator() -> (MeetingPromptCoordinator, TestContext) {
    let ctx = TestContext()
    let coord = MeetingPromptCoordinator(
        watcher: ctx.watcher,
        action: ctx.action,
        alertPresenter: ctx.alerts,
        settings: ctx.settings
    )
    return (coord, ctx)
}

// MARK: - Timing helpers

/// Poll `predicate` every 5 ms until it returns `true`, up to `timeoutMs`.
/// Replaces fixed-duration `Task.sleep(...)` waits that were flaky under
/// load — the coordinator's real dispatch takes ~110 ms on a quiet machine
/// but climbs above 100 ms during the full pre-push pipeline. Polling
/// tracks actual work completion rather than betting on wall-clock budget.
@MainActor
private func waitUntil(timeoutMs: Int, _ predicate: @MainActor () -> Bool) async {
    let deadline = Date().addingTimeInterval(TimeInterval(timeoutMs) / 1_000)
    while Date() < deadline {
        if predicate() { return }
        try? await Task.sleep(nanoseconds: 5_000_000)  // 5 ms
    }
}

// MARK: - Fakes

@MainActor
private final class FakeMeetingEventProvider: MeetingEventProviding {
    let meetingEvents: AsyncStream<Bool>
    private let continuation: AsyncStream<Bool>.Continuation

    init() {
        var cont: AsyncStream<Bool>.Continuation?
        self.meetingEvents = AsyncStream<Bool>(bufferingPolicy: .bufferingNewest(1)) {
            cont = $0
        }
        // swiftlint:disable:next force_unwrapping
        self.continuation = cont!
    }

    func feed(_ active: Bool) { continuation.yield(active) }
    func finish() { continuation.finish() }
}

@MainActor
private final class FakeAction: RecordingActionHandling {
    var state: RecordingManager.State = .idle
    var startCount = 0
    var stopCount = 0

    func requestStart() async {
        startCount += 1
        state = .recording
    }

    func requestStop() async {
        stopCount += 1
        state = .idle
    }
}

@MainActor
private final class FakeAlertPresenter: AlertPresenting {
    var choiceCount = 0
    var errorCount = 0
    var choiceReturn: Bool = false
    var lastChoicePrimary: String = ""
    var lastChoiceSecondary: String = ""
    /// Hook fired synchronously before returning `choiceReturn`. Lets tests
    /// simulate side effects that would race with the modal (e.g. a burst
    /// of upstream events during presentation).
    var onBeforePresentChoice: (@MainActor () -> Void)?

    func presentChoice(
        title: String,
        message: String,
        primary: String,
        secondary: String
    ) -> Bool {
        choiceCount += 1
        lastChoicePrimary = primary
        lastChoiceSecondary = secondary
        onBeforePresentChoice?()
        return choiceReturn
    }

    func presentError(title: String, message: String) {
        errorCount += 1
    }
}
