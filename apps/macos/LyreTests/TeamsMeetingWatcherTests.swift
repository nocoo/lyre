import CoreGraphics
import Foundation
import Testing
@testable import Lyre

@MainActor @Suite("Teams call evidence and watcher lifecycle")
struct TeamsMeetingWatcherTests {
    @Test(arguments: [
        ("Meeting in Sprint | Microsoft Teams", true),
        ("Alice's Meeting | Microsoft Teams", true),
        ("会议 | Microsoft Teams", true),
        ("會議 | Microsoft Teams", true),
        ("会议中 | Microsoft Teams", true),
        ("Chat | Calling/Meeting/Devices | General | Microsoft Teams", false),
        ("Meetings | Microsoft Teams", false),
        ("Meeting notes | Microsoft Teams", false),
        ("Foo Meeting Bar | Microsoft Teams", false),
        ("Sprint Planning | Microsoft Teams", false),
        ("Meeting in Sprint", false),
    ])
    func titleRequiresAnExplicitMeetingSlot(_ title: String, expected: Bool) {
        #expect(TeamsMeetingWatcher.isMeetingTitle(title) == expected)
    }

    @Test func multipleChatWindowsAreNotAMeeting() {
        let windows = [window("Chat | General | Microsoft Teams"), window("Sprint Planning | Microsoft Teams")]
        #expect(!TeamsMeetingWatcher.judgeMeeting(from: windows))
    }

    @Test func minimizedAndOtherSpaceMeetingWindowsRemainEvidence() {
        #expect(TeamsMeetingWatcher.judgeMeeting(from: [window("会议 | Microsoft Teams", onScreen: false)]))
        #expect(!TeamsMeetingWatcher.judgeMeeting(from: [
            window("会议 | Microsoft Teams", bundleID: "another.app"),
            window("会议 | Microsoft Teams", width: 1)
        ]))
    }

    @Test func startupBaselineIsSilent() async {
        let context = WatcherContext()
        context.watcher.testingSubmit(rawActive: true)
        #expect(context.watcher.testingConfirmedActive == true)
        #expect(await finishAndCollect(context.watcher).isEmpty)
    }

    @Test func startsNeedTenSecondsAndEndsNeedThirtySeconds() async {
        let context = WatcherContext()
        context.submit(false, at: 0)
        context.submit(true, at: 1)
        context.submit(true, at: 10.9)
        #expect(context.watcher.testingConfirmedActive == false)
        context.submit(true, at: 11)
        #expect(context.watcher.testingConfirmedActive == true)
        context.submit(false, at: 12)
        context.submit(false, at: 41.9)
        #expect(context.watcher.testingConfirmedActive == true)
        context.submit(false, at: 42)
        #expect(context.watcher.testingConfirmedActive == false)
        #expect(await finishAndCollect(context.watcher) == [false])
    }

    @Test func noiseAndUnavailableObservationResetTheGracePeriod() {
        let context = WatcherContext()
        defer { context.watcher.stopAndFinish() }
        context.submit(true, at: 0)
        context.submit(false, at: 1)
        context.submit(true, at: 20)
        context.submit(false, at: 21)
        context.watcher.testingHandleObservationUnavailable()
        context.submit(false, at: 100)
        #expect(context.watcher.testingConfirmedActive == true)
        context.submit(false, at: 129)
        #expect(context.watcher.testingConfirmedActive == true)
        context.submit(false, at: 130)
        #expect(context.watcher.testingConfirmedActive == false)
    }

    @Test func teamsNotRunningAtLaunchStillAllowsFirstMeetingReminder() async {
        let context = WatcherContext()
        context.apps.alive = false
        context.watcher.start()
        #expect(context.watcher.testingConfirmedActive == false)
        context.apps.alive = true
        context.audio.result = TeamsAudioActivity(input: true, output: true)
        context.time = 1
        await context.watcher.testingTick()
        context.time = 11
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == true)
        #expect(await finishAndCollect(context.watcher) == [true])
    }

    @Test func duplexAudioSurvivesSpaceChangesWithoutAWindowQuery() async {
        let context = WatcherContext()
        context.audio.result = TeamsAudioActivity(input: true, output: true)
        context.watcher.start()
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == true)
        #expect(context.content.callCount == 0)
        #expect(await finishAndCollect(context.watcher).isEmpty)
    }

    @Test func microphonePreviewAndTwoChatsDoNotStartAMeeting() async {
        let context = WatcherContext()
        defer { context.watcher.stopAndFinish() }
        context.audio.result = TeamsAudioActivity(input: true, output: false)
        context.content.windows = [window("Chat | General | Microsoft Teams"), window("Another chat")]
        context.watcher.start()
        await context.watcher.testingTick()
        context.time = 100
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == false)
    }

    @Test func oneWayAudioNeedsAnExplicitMeetingWindow() async {
        let context = WatcherContext()
        defer { context.watcher.stopAndFinish() }
        context.audio.result = TeamsAudioActivity(input: false, output: true)
        context.watcher.start()
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == false)
        context.content.windows = [window("Meeting in Sprint | Microsoft Teams")]
        context.time = 1
        await context.watcher.testingTick()
        context.time = 11
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == true)
    }

    @Test func mutedOffscreenMeetingDoesNotEndRecording() async {
        let context = WatcherContext()
        defer { context.watcher.stopAndFinish() }
        context.audio.result = TeamsAudioActivity(input: true, output: true)
        context.watcher.start()
        await context.watcher.testingTick()
        context.audio.result = TeamsAudioActivity(input: false, output: false)
        context.content.windows = [window("会议 | Microsoft Teams", onScreen: false)]
        context.time = 1
        await context.watcher.testingTick()
        context.time = 100
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == true)
    }

    @Test func unknownAudioOrFailedWindowQueryNeverMeansMeetingEnded() async {
        let context = WatcherContext()
        defer { context.watcher.stopAndFinish() }
        context.audio.result = TeamsAudioActivity(input: true, output: true)
        context.watcher.start()
        await context.watcher.testingTick()
        context.audio.result = nil
        context.time = 1
        await context.watcher.testingTick()
        context.time = 100
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == true)
        context.audio.result = TeamsAudioActivity(input: false, output: false)
        context.content.shouldThrow = true
        context.time = 200
        await context.watcher.testingTick()
        context.time = 300
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == true)
    }

    @Test func missingPermissionNeverEnumeratesWindows() async {
        let context = WatcherContext()
        context.permissions.granted = false
        context.watcher.start()
        await context.watcher.testingTick()
        #expect(context.content.callCount == 0)
        #expect(await finishAndCollect(context.watcher).isEmpty)
    }

    @Test func processExitEndsOnlyAPreviouslyConfirmedMeeting() async {
        let context = WatcherContext()
        context.submit(true, at: 0)
        context.apps.alive = false
        context.watcher.testingRecomputeTier()
        #expect(context.watcher.testingConfirmedActive == false)
        #expect(await finishAndCollect(context.watcher) == [false])
    }

    @Test func queriesDoNotOverlapAndLateResultsAfterSuspendAreIgnored() async {
        let context = WatcherContext()
        context.audio.result = TeamsAudioActivity(input: true, output: false)
        context.content.windows = [window("会议 | Microsoft Teams")]
        context.content.isBlocked = true
        context.watcher.start()
        await waitUntil { context.content.callCount == 1 }
        let extraTick = Task { await context.watcher.testingTick() }
        await Task.yield()
        #expect(context.content.callCount == 1)
        context.watcher.suspend()
        context.content.release()
        await extraTick.value
        #expect(context.watcher.testingConfirmedActive == nil)
        context.audio.result = TeamsAudioActivity(input: false, output: false)
        context.content.windows = []
        context.watcher.resume()
        await context.watcher.testingTick()
        #expect(context.watcher.testingConfirmedActive == false)
        #expect(await finishAndCollect(context.watcher).isEmpty)
    }

    @Test func repeatedStartAndSuspendAreSafeAndStreamFinishes() async {
        let context = WatcherContext()
        context.watcher.start()
        context.watcher.start()
        await context.watcher.testingTick()
        context.watcher.suspend()
        context.watcher.suspend()
        context.watcher.resume()
        await context.watcher.testingTick()
        #expect(await finishAndCollect(context.watcher).isEmpty)
    }
}

private func window(
    _ title: String, onScreen: Bool = true, bundleID: String = "com.microsoft.teams2", width: CGFloat = 800
) -> ShareableWindow {
    ShareableWindow(bundleID: bundleID, title: title, isOnScreen: onScreen,
                    frame: CGRect(x: 0, y: 0, width: width, height: 600))
}

@MainActor private final class WatcherContext {
    let apps = FakeRunningApps()
    let content = FakeContent()
    let permissions = FakePermissions()
    let audio = FakeAudioActivity()
    var time: TimeInterval = 0
    lazy var watcher = TeamsMeetingWatcher(
        runningApps: apps, content: content, permissions: permissions, audioActivity: audio,
        now: { [weak self] in self?.time ?? 0 }
    )
    func submit(_ active: Bool, at time: TimeInterval) {
        self.time = time
        watcher.testingSubmit(rawActive: active)
    }
}

@MainActor private final class FakeRunningApps: RunningAppsProviding {
    var alive = true
    func isBundleRunning(anyOf ids: Set<String>) -> Bool { alive }
}

@MainActor private final class FakeContent: ShareableContentProviding {
    var windows: [ShareableWindow] = []
    var shouldThrow = false
    var callCount = 0
    var isBlocked = false
    private var continuation: CheckedContinuation<Void, Never>?

    func currentTeamsWindows(bundleIDs: Set<String>) async throws -> [ShareableWindow] {
        callCount += 1
        if isBlocked { await withCheckedContinuation { continuation = $0 } }
        if shouldThrow { throw CocoaError(.fileReadUnknown) }
        return windows
    }

    func release() {
        isBlocked = false
        continuation?.resume()
        continuation = nil
    }
}

private final class FakePermissions: RecordingPermissions {
    var granted = true
    var allGranted: Bool { granted }
    var needsSetup: Bool { !granted }
    var screenCaptureGranted: Bool { granted }
    func checkAll() async {}
}

@MainActor private final class FakeAudioActivity: TeamsAudioActivityProviding {
    var result: TeamsAudioActivity? = TeamsAudioActivity(input: false, output: false)
    func activity(for bundleIDs: Set<String>) -> TeamsAudioActivity? { result }
}

@MainActor private func finishAndCollect(_ watcher: TeamsMeetingWatcher) async -> [Bool] {
    watcher.stopAndFinish()
    var events: [Bool] = []
    for await event in watcher.meetingEvents { events.append(event) }
    return events
}

@MainActor private func waitUntil(_ predicate: () -> Bool) async {
    let deadline = Date().addingTimeInterval(2)
    while !predicate() && Date() < deadline { await Task.yield() }
    #expect(predicate())
}
