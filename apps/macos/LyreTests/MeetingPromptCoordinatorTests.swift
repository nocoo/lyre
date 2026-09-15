import Foundation
import Testing
@testable import Lyre

@MainActor @Suite("Optional meeting reminders")
struct MeetingPromptCoordinatorTests {
    @Test func acceptedStartOwnsOnlyThatRecordingAndMayOfferStop() async {
        let context = PromptContext()
        context.alerts.answer = true
        await context.coordinator.handle(active: true)
        #expect(context.action.startCount == 1)
        #expect(context.action.recordingID != nil)
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 2)
        #expect(context.action.stopCount == 1)
    }

    @Test func manualRecordingsNeverGetAnEndingPrompt() async {
        let context = PromptContext()
        await context.action.requestStart()
        await context.coordinator.handle(active: true)
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 0)
        #expect(context.action.stopCount == 0)
    }

    @Test func declineOrExpiryIsQuietForTheRestOfTheMeeting() async {
        let context = PromptContext()
        await context.coordinator.handle(active: true)
        await context.coordinator.handle(active: true)
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 1)
        #expect(context.action.startCount == 0)
        await context.coordinator.handle(active: true)
        #expect(context.alerts.choiceCount == 2)
    }

    @Test func keepingRecordingDoesNotOfferStopAgain() async {
        let context = PromptContext()
        context.alerts.answer = true
        await context.coordinator.handle(active: true)
        context.alerts.answer = false
        await context.coordinator.handle(active: false)
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 2)
        #expect(context.action.stopCount == 0)
        #expect(context.action.state == .recording)
    }

    @Test func replacingMeetingRecordingWithManualOneRemovesStopOwnership() async {
        let context = PromptContext()
        context.alerts.answer = true
        await context.coordinator.handle(active: true)
        let meetingID = context.action.recordingID
        await context.action.requestStop()
        await context.action.requestStart()
        #expect(context.action.recordingID != meetingID)
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 1)
        #expect(context.action.stopCount == 1) // the manual stop only
    }

    @Test func failedStartDoesNotClaimALaterManualRecording() async {
        let context = PromptContext()
        context.alerts.answer = true
        context.action.failStart = true
        await context.coordinator.handle(active: true)
        context.action.failStart = false
        await context.action.requestStart()
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 1)
        #expect(context.action.stopCount == 0)
    }

    @Test func lateStartConfirmationAfterMeetingEndedDoesNothing() async {
        let context = PromptContext()
        context.alerts.hold = true
        context.alerts.ignoreDismissal = true
        let pending = Task { await context.coordinator.handle(active: true) }
        await waitUntil { context.alerts.isPending }
        await context.coordinator.handle(active: false)
        context.alerts.resolve(true)
        await pending.value
        #expect(context.action.startCount == 0)
        #expect(context.action.stopCount == 0)
    }

    @Test func disablingRemindersInvalidatesAnAlreadyVisibleChoice() async {
        let context = PromptContext()
        context.alerts.hold = true
        context.alerts.ignoreDismissal = true
        let pending = Task { await context.coordinator.handle(active: true) }
        await waitUntil { context.alerts.isPending }
        context.settings.isEnabled = false
        context.coordinator.settingsDidChange()
        context.alerts.resolve(true)
        await pending.value
        #expect(context.action.startCount == 0)
        #expect(context.alerts.dismissed > 0)
    }

    @Test func manualStartRetractsAnOpenReminder() async {
        let context = PromptContext()
        context.alerts.hold = true
        let pending = Task { await context.coordinator.handle(active: true) }
        await waitUntil { context.alerts.isPending }
        await context.action.requestStart()
        context.coordinator.recordingStateDidChange()
        await pending.value
        #expect(!context.alerts.isPending)
        await context.coordinator.handle(active: false)
        #expect(context.alerts.choiceCount == 1)
        #expect(context.action.startCount == 1)
        #expect(context.action.stopCount == 0)
    }

    @Test func oldStopChoiceCannotStopANewSession() async {
        let context = PromptContext()
        context.alerts.answer = true
        await context.coordinator.handle(active: true)
        context.alerts.hold = true
        context.alerts.ignoreDismissal = true
        let pending = Task { await context.coordinator.handle(active: false) }
        await waitUntil { context.alerts.isPending }
        await context.action.requestStop()
        await context.action.requestStart()
        context.coordinator.recordingStateDidChange()
        context.alerts.resolve(true)
        await pending.value
        #expect(context.action.stopCount == 1)
        #expect(context.action.state == .recording)
    }

    @Test func streamKeepsConsumingWhileReminderIsOpen() async {
        let context = PromptContext()
        context.alerts.hold = true
        context.coordinator.start()
        context.watcher.feed(true)
        await waitUntil { context.alerts.isPending }
        context.watcher.feed(false)
        await waitUntil { !context.alerts.isPending }
        #expect(context.action.startCount == 0)
        context.watcher.feed(true)
        await waitUntil { context.alerts.choiceCount == 2 }
        context.coordinator.stop()
        #expect(!context.alerts.isPending)
    }

    @Test func disabledAndBusyStatesDoNotPrompt() async {
        let context = PromptContext()
        context.settings.isEnabled = false
        await context.coordinator.handle(active: true)
        #expect(context.alerts.choiceCount == 0)
        context.settings.isEnabled = true
        context.coordinator.settingsDidChange()
        context.action.isBusy = true
        await context.coordinator.handle(active: true)
        #expect(context.alerts.choiceCount == 0)
    }

    @Test func relaunchSuspensionInvalidatesChoicesAndCanResumeTheSameEventStream() async {
        let context = PromptContext()
        context.alerts.hold = true
        context.alerts.ignoreDismissal = true
        context.coordinator.start()
        context.watcher.feed(true)
        await waitUntil { context.alerts.isPending }
        context.coordinator.setSuspended(true)
        context.alerts.resolve(true)
        await context.coordinator.handle(active: true)
        #expect(context.action.startCount == 0)
        #expect(context.settings.isEnabled)

        context.coordinator.setSuspended(false)
        context.alerts.hold = false
        context.alerts.answer = true
        context.watcher.feed(true)
        await waitUntil { context.action.startCount == 1 }
        #expect(context.alerts.choiceCount == 2)
        context.coordinator.stop()
    }
}

@MainActor private final class PromptContext {
    let watcher = FakeMeetingEvents()
    let action = FakeAction()
    let alerts = FakeAlerts()
    let settings: MeetingDetectionSettings
    lazy var coordinator = MeetingPromptCoordinator(
        watcher: watcher, action: action, alertPresenter: alerts, settings: settings
    )

    init() {
        let suite = "MeetingPromptCoordinatorTests.\(UUID().uuidString)"
        settings = MeetingDetectionSettings(defaults: UserDefaults(suiteName: suite)!)
        settings.isEnabled = true
    }
}

@MainActor private final class FakeMeetingEvents: MeetingEventProviding {
    let meetingEvents: AsyncStream<Bool>
    private let continuation: AsyncStream<Bool>.Continuation
    init() {
        let pair = AsyncStream<Bool>.makeStream(bufferingPolicy: .bufferingNewest(1))
        meetingEvents = pair.stream
        continuation = pair.continuation
    }
    func feed(_ active: Bool) { continuation.yield(active) }
}

@MainActor private final class FakeAction: RecordingActionHandling {
    var state: RecordingManager.State = .idle
    var isBusy = false
    var recordingID: UUID?
    var startCount = 0
    var stopCount = 0
    var failStart = false

    @discardableResult func requestStart() async -> UUID? {
        guard state == .idle, !isBusy else { return nil }
        startCount += 1
        guard !failStart else { return nil }
        state = .recording
        recordingID = UUID()
        return recordingID
    }

    func requestStop() async {
        guard state == .recording, !isBusy else { return }
        stopCount += 1
        state = .idle
        recordingID = nil
    }
}

@MainActor private final class FakeAlerts: AlertPresenting {
    var answer = false
    var choiceCount = 0
    var dismissed = 0
    var hold = false
    var ignoreDismissal = false
    var isPending: Bool { continuation != nil }
    private var continuation: CheckedContinuation<Bool, Never>?

    func presentChoice(title: String, message: String, primary: String, secondary: String) async -> Bool {
        choiceCount += 1
        if hold { return await withCheckedContinuation { continuation = $0 } }
        return answer
    }

    func resolve(_ answer: Bool) {
        let pending = continuation
        continuation = nil
        pending?.resume(returning: answer)
    }

    func dismissChoice() {
        guard isPending else { return }
        dismissed += 1
        if !ignoreDismissal { resolve(false) }
    }

    func presentError(title: String, message: String) {}
}

@MainActor private func waitUntil(_ predicate: () -> Bool) async {
    let deadline = Date().addingTimeInterval(2)
    while !predicate() && Date() < deadline { await Task.yield() }
    #expect(predicate())
}
