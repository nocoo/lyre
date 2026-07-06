import CoreGraphics
import Foundation
import Testing
@testable import Lyre

// swiftlint:disable file_length
//
// These tests document the v1.3 judgeMeeting contract fully (F1/F2/F3
// regressions) plus the lifecycle behaviour of the debounce state machine.
// Splitting into multiple files would obscure the single suite against a
// single production type.

/// Small helper so table-style test cases are readable.
private func win(
    _ bid: String = "com.microsoft.teams2",
    title: String?,
    onScreen: Bool = true,
    width: CGFloat = 800,
    height: CGFloat = 600
) -> ShareableWindow {
    ShareableWindow(
        bundleID: bid,
        title: title,
        isOnScreen: onScreen,
        frame: CGRect(x: 0, y: 0, width: width, height: height)
    )
}

@MainActor
@Suite("TeamsMeetingWatcher — judgeMeeting v1.3 contract")
struct TeamsMeetingWatcherJudgeTests {
    // MARK: - Count judgement (F1 + F3 regression)

    @Test func count_twoOnScreenSizedNonExcluded_yieldsTrue() {
        let windows = [
            win(title: "Meeting in Sprint | Microsoft Teams"),
            win(title: "Alice's Meeting | Microsoft Teams"),
        ]
        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == true)
    }

    @Test func count_offscreenCandidateDoesNotContributeToCount() {
        // Use titles that deliberately do NOT hit the title-slot rule, so
        // a `true` result would prove count>=2 mistakenly counted the
        // offscreen window. `"Chat"` head + `Microsoft Teams` suffix hits
        // neither the prefix nor the suffix nor the exact rule.
        let windows = [
            win(title: "Chat | Alpha | Microsoft Teams", onScreen: false),
            win(title: "Chat | Beta | Microsoft Teams"),
        ]
        // Sanity: title-slot alone must be false for both candidates.
        #expect(TeamsMeetingWatcher.isMeetingTitle(windows[0].title) == false)
        #expect(TeamsMeetingWatcher.isMeetingTitle(windows[1].title) == false)
        // Full judgement: with 1 offscreen dropped, count is 1, no title-slot
        // hit → must be false.
        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == false)
    }

    @Test func count_undersizedCandidateDoesNotContributeToCount() {
        let windows = [
            win(title: "Chat Popout", width: 150, height: 150),
            win(title: "Random Panel", width: 100, height: 100),
        ]
        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == false)
    }

    // MARK: - Title slot judgement (positive)

    @Test func titleSlot_meetingInSubject_yieldsTrue() {
        #expect(TeamsMeetingWatcher.isMeetingTitle("Meeting in Sprint | Microsoft Teams") == true)
    }

    @Test func titleSlot_apostropheSMeeting_yieldsTrue() {
        #expect(TeamsMeetingWatcher.isMeetingTitle("Alice's Meeting | Microsoft Teams") == true)
    }

    @Test func titleSlot_exactChineseMeeting_yieldsTrue() {
        #expect(TeamsMeetingWatcher.isMeetingTitle("会议 | Microsoft Teams") == true)
        #expect(TeamsMeetingWatcher.isMeetingTitle("會議 | Microsoft Teams") == true)
        #expect(TeamsMeetingWatcher.isMeetingTitle("会议中 | Microsoft Teams") == true)
    }

    // MARK: - Title slot judgement (F2 negatives)

    @Test func titleSlot_chatChannelContainingMeetingWord_yieldsFalse() {
        // F2 regression: Chat channel names that happen to contain "meeting"
        // must not fire the detector on idle.
        let title = "Chat | Calling/Meeting/Devices | General | Microsoft Teams"
        #expect(TeamsMeetingWatcher.isMeetingTitle(title) == false)
    }

    @Test func titleSlot_freeformSubjectWithoutMeetingWord_yieldsFalse() {
        #expect(TeamsMeetingWatcher.isMeetingTitle("讨论 | Microsoft Teams") == false)
    }

    @Test func titleSlot_missingSuffix_yieldsFalse() {
        #expect(TeamsMeetingWatcher.isMeetingTitle("Random Chat") == false)
    }

    @Test func titleSlot_meetingWordInMiddle_yieldsFalse() {
        // head = "foo meeting bar" — neither prefix nor suffix rule matches.
        #expect(TeamsMeetingWatcher.isMeetingTitle("Foo Meeting Bar | Microsoft Teams") == false)
    }

    // MARK: - Excluded titles (F3 regression)

    @Test func excludedTitle_teamsNRC_isDropped() {
        let windows = [
            win(title: "Teams NRC", width: 1, height: 1),
            win(title: "Select a certificate for authentication", width: 512, height: 286),
        ]
        // Both are excluded (or fail the size gate); no title-slot hit either.
        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == false)
    }

    @Test func excludedTitle_mainWindow_isDropped() {
        let windows = [
            win(title: "Microsoft Teams"),
            win(title: "Settings"),
        ]
        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == false)
    }

    // MARK: - Real-world regression: idle chat scene

    @Test func idleChatSceneWithHelperClutter_yieldsFalse() {
        // Reproduces the Phase 0 probe payload: 14 offscreen/small helper
        // windows plus 1 on-screen "Chat | ... | Microsoft Teams" main
        // window. Must be inactive, otherwise Lyre will pop the prompt
        // whenever the user just has Teams open.
        var windows: [ShareableWindow] = []
        windows.append(win(title: "Microsoft Teams", onScreen: false))
        for _ in 0..<8 {
            windows.append(win(title: "", onScreen: false, width: 3360, height: 30))
        }
        windows.append(win(title: "Select a certificate for authentication",
                           onScreen: false, width: 512, height: 286))
        windows.append(win(title: "Select a certificate for authentication",
                           onScreen: false, width: 512, height: 286))
        windows.append(win(title: "", onScreen: false, width: 45, height: 19))
        windows.append(win(title: "", onScreen: false, width: 84, height: 77))
        windows.append(win(title: "Teams NRC", onScreen: false, width: 1, height: 1))
        windows.append(win(
            title: "Chat | Calling/Meeting/Devices | General | Microsoft Teams",
            onScreen: true,
            width: 1680,
            height: 1860
        ))

        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == false)
    }

    // MARK: - Real-world positive: main + separate meeting window

    @Test func mainPlusSeparateMeetingWindow_yieldsTrue() {
        // Main window (chat title, does NOT hit title-slot rule) + a
        // separate on-screen meeting window that also does not hit the
        // title-slot rule (subject-only, no "meeting" head). Count judgement
        // must catch this.
        let windows = [
            win(title: "Chat | General | Microsoft Teams"),
            win(title: "Sprint Planning | Microsoft Teams"),
        ]
        #expect(TeamsMeetingWatcher.judgeMeeting(from: windows) == true)
    }
}

@MainActor
@Suite("TeamsMeetingWatcher — debounce + baseline + lifecycle")
struct TeamsMeetingWatcherLifecycleTests {
    // MARK: - Baseline

    @Test func baseline_activeState_seedsWithoutYield() async {
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )

        watcher.testingSubmit(rawActive: true)  // baseline tick lands true

        #expect(watcher.testingConfirmedActive == true)

        // Confirm the stream does not yield a baseline event. Read with a
        // short timeout: if anything shows up in the buffer it is a bug.
        await withTimeoutExpectingNoEvent(watcher.meetingEvents, ms: 20)
    }

    @Test func baseline_inactiveState_seedsWithoutYield() async {
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        watcher.testingSubmit(rawActive: false)
        #expect(watcher.testingConfirmedActive == false)
        await withTimeoutExpectingNoEvent(watcher.meetingEvents, ms: 20)
    }

    // MARK: - Debounce

    @Test func debounce_requiresTwoMatchingTicks_beforeYielding() async throws {
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        // Baseline false, then need two consecutive `true` to flip.
        watcher.testingSubmit(rawActive: false)  // baseline
        watcher.testingSubmit(rawActive: true)   // 1st raw true — no flip yet
        #expect(watcher.testingConfirmedActive == false)
        watcher.testingSubmit(rawActive: true)   // 2nd raw true — flip
        #expect(watcher.testingConfirmedActive == true)

        let first = try await nextEvent(watcher.meetingEvents, timeoutMs: 200)
        #expect(first == true)
    }

    @Test func debounce_transientNoiseIsIgnored() async {
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        watcher.testingSubmit(rawActive: false)  // baseline
        watcher.testingSubmit(rawActive: true)   // single noise tick
        watcher.testingSubmit(rawActive: false)  // back to false
        watcher.testingSubmit(rawActive: false)  // confirmed still false — no yield
        #expect(watcher.testingConfirmedActive == false)
        await withTimeoutExpectingNoEvent(watcher.meetingEvents, ms: 20)
    }

    // MARK: - SCK permission gate

    @Test func sckNotGranted_producesSilentInactive() async throws {
        // From cold start with SCK not granted, the watcher must not call
        // the SCK provider at all and must not yield any events. Baseline
        // is intentionally never established because we cannot observe.
        let content = FakeContent()
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: content,
            permissions: FakePerms(sck: false)
        )
        watcher.start()

        // Give the initial tick a chance to run + observe the SCK provider
        // was never called and no event was yielded.
        try await Task.sleep(nanoseconds: 30_000_000)  // 30ms
        #expect(content.callCount == 0)
        await withTimeoutExpectingNoEvent(watcher.meetingEvents, ms: 20)

        watcher.stopAndFinish()
    }

    @Test func sckRevokedAfterActive_doesNotYieldFalse() async {
        // Regression for C6 blocker: once `confirmedActive == true`,
        // subsequent unauthorised ticks must not flip via the debounce
        // path and yield a false transition (which C7 would treat as
        // "meeting ended" and pop a Stop prompt).
        let content = FakeContent()
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: content,
            permissions: FakePerms(sck: true)
        )
        // Seed baseline as active via the debounce hook (avoids waiting on
        // real timers) and confirm it is set.
        watcher.testingSubmit(rawActive: true)
        #expect(watcher.testingConfirmedActive == true)

        // Simulate two ticks that hit the observation-unavailable branch —
        // whether the cause is a revoked TCC or the SCK API throwing, the
        // watcher must skip provider calls entirely and never yield a
        // false transition through the debounce path.
        watcher.testingHandleObservationUnavailable()
        watcher.testingHandleObservationUnavailable()

        // No provider calls were made (checkTeamsWindows short-circuits in
        // both branches), and no yield reached the stream.
        #expect(content.callCount == 0)
        await withTimeoutExpectingNoEvent(watcher.meetingEvents, ms: 20)
        // confirmedActive stays at its last confirmed value so tray / logs
        // still reflect the last true observation.
        #expect(watcher.testingConfirmedActive == true)
    }

    @Test func sckThrows_doesNotYieldFalse() async {
        // SCK provider throwing must be treated as a transient observation
        // failure, not as "meeting ended". Same contract as revoked
        // permission — no yield, no flip.
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        watcher.testingSubmit(rawActive: true)   // baseline active
        #expect(watcher.testingConfirmedActive == true)

        // Exercise the observation-unavailable branch twice (mirrors two
        // consecutive SCK throws) and prove no false transition escaped.
        watcher.testingHandleObservationUnavailable()
        watcher.testingHandleObservationUnavailable()

        await withTimeoutExpectingNoEvent(watcher.meetingEvents, ms: 20)
        #expect(watcher.testingConfirmedActive == true)
    }

    // MARK: - Termination

    @Test func teamsTerminates_whileActive_yieldsFalseImmediately() async throws {
        let running = FakeRunningApps(alive: true)
        let watcher = TeamsMeetingWatcher(
            runningApps: running,
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        // Move to confirmed active without touching production timers.
        watcher.testingSubmit(rawActive: true)  // baseline true
        #expect(watcher.testingConfirmedActive == true)

        // Simulate the process leaving: flip running-apps to false and
        // recompute (production goes through the NSWorkspace notification,
        // which lands in `recomputeTier` — we exercise that path directly).
        running.alive = false
        watcher.testingRecomputeTier()

        let event = try await nextEvent(watcher.meetingEvents, timeoutMs: 200)
        #expect(event == false)
        #expect(watcher.testingConfirmedActive == false)
    }

    // MARK: - Suspend/resume

    @Test func suspend_thenResume_reusesSameStream() async throws {
        // Suspend must not finish the stream. After a suspend/resume cycle,
        // the same for-await consumer must still receive events from the
        // debounced state machine. We drive the debouncer directly via the
        // testing hook so timer/provider ticks do not race the assertion.
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        watcher.suspend()   // no-op given we haven't started, but exercises teardown
        watcher.resume()    // resume must not throw / finish stream

        // Manually drive baseline + a confirmed true transition via the
        // debounce state machine (no real Timer / provider involved).
        watcher.testingSubmit(rawActive: false)  // baseline
        watcher.testingSubmit(rawActive: true)   // 1st raw true — no yield
        watcher.testingSubmit(rawActive: true)   // 2nd — yield true

        let event = try await nextEvent(watcher.meetingEvents, timeoutMs: 200)
        #expect(event == true)

        // Explicit teardown: `suspend()` again to invalidate the timer that
        // `resume()` scheduled, then finish the stream.
        watcher.stopAndFinish()
    }

    @Test func stopAndFinish_endsStream() async {
        let watcher = TeamsMeetingWatcher(
            runningApps: FakeRunningApps(alive: true),
            content: FakeContent(),
            permissions: FakePerms(sck: true)
        )
        watcher.start()
        watcher.stopAndFinish()

        var collected: [Bool] = []
        for await value in watcher.meetingEvents {
            collected.append(value)
        }
        // Loop must terminate; may or may not have events depending on
        // whether the initial tick fired before finish, but the key
        // invariant is that we exit rather than block forever.
        #expect(collected.count <= 1)
    }
}

// MARK: - Fakes

@MainActor
private final class FakeRunningApps: RunningAppsProviding {
    var alive: Bool
    init(alive: Bool) { self.alive = alive }
    func isBundleRunning(anyOf ids: Set<String>) -> Bool { alive }
}

@MainActor
private final class FakeContent: ShareableContentProviding {
    var windowsToReturn: [ShareableWindow] = []
    var errorToThrow: Error?
    var callCount = 0

    func currentTeamsWindows(bundleIDs: Set<String>) async throws -> [ShareableWindow] {
        callCount += 1
        if let error = errorToThrow { throw error }
        return windowsToReturn
    }
}

private final class FakePerms: RecordingPermissions, @unchecked Sendable {
    var allGranted: Bool { sck }
    var needsSetup: Bool { !sck }
    var screenCaptureGranted: Bool { sck }
    private let sck: Bool
    init(sck: Bool) { self.sck = sck }
    func checkAll() async {}
}

// MARK: - Stream helpers

/// Wait up to `ms` milliseconds for the *next* event on `stream`. Times out
/// as a Swift Testing failure — used when we expect an event but don't want
/// the test to hang forever.
private func nextEvent(
    _ stream: AsyncStream<Bool>,
    timeoutMs: Int
) async throws -> Bool {
    try await withThrowingTaskGroup(of: Bool.self) { group in
        group.addTask {
            for await value in stream { return value }
            throw StreamTimeoutError.streamEnded
        }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
            throw StreamTimeoutError.timedOut
        }
        let result = try await group.next()!
        group.cancelAll()
        return result
    }
}

/// Assert that no event arrives in `ms` milliseconds. Used to prove baseline
/// silence — a false positive here indicates the debounce contract regressed.
private func withTimeoutExpectingNoEvent(
    _ stream: AsyncStream<Bool>,
    ms: Int
) async {
    let outcome = await withTaskGroup(of: OneOrTimeout.self) { group in
        group.addTask {
            for await _ in stream { return .event }
            return .streamEnded
        }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
            return .timeout
        }
        let first = await group.next() ?? .timeout
        group.cancelAll()
        return first
    }
    #expect(outcome == .timeout || outcome == .streamEnded)
}

private enum StreamTimeoutError: Error {
    case timedOut
    case streamEnded
}

private enum OneOrTimeout: Equatable {
    case event
    case timeout
    case streamEnded
}

// swiftlint:enable file_length
