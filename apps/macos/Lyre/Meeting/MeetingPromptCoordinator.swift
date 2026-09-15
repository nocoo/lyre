import Foundation

/// Optional reminders never own a modal run loop or stop a manual recording.
/// Every confirmation is checked again against the current meeting and session.
@MainActor
final class MeetingPromptCoordinator {
    private let watcher: MeetingEventProviding
    private let action: RecordingActionHandling
    private let alertPresenter: AlertPresenting
    private let settings: MeetingDetectionSettings

    private var consumeTask: Task<Void, Never>?
    private var promptTask: Task<Void, Never>?
    private var pendingPrompt: PromptKind?
    private var revision = 0
    private var isSuspended = false
    private var meetingRecordingID: UUID?
    // swiftlint:disable:next discouraged_optional_boolean
    private var lastObservedActive: Bool?

    private enum PromptKind {
        case start
        case stop(UUID)
    }

    init(
        watcher: MeetingEventProviding,
        action: RecordingActionHandling,
        alertPresenter: AlertPresenting,
        settings: MeetingDetectionSettings
    ) {
        self.watcher = watcher
        self.action = action
        self.alertPresenter = alertPresenter
        self.settings = settings
    }

    func start() {
        guard consumeTask == nil else { return }
        consumeTask = Task { @MainActor [weak self] in
            guard let stream = self?.watcher.meetingEvents else { return }
            for await active in stream {
                guard !Task.isCancelled else { return }
                self?.dispatch(active: active)
            }
        }
    }

    func stop() {
        consumeTask?.cancel()
        consumeTask = nil
        cancelPrompt()
    }

    /// Pause during an app relaunch without cancelling the shared event stream.
    /// If opening the new instance fails, the existing consumer can resume.
    func setSuspended(_ suspended: Bool) {
        isSuspended = suspended
        settingsDidChange()
    }

    /// Called with the settings switch, including when the main window closes.
    func settingsDidChange() {
        cancelPrompt()
        meetingRecordingID = nil
        lastObservedActive = nil
    }

    /// Called by the shared recording controller, independent of view lifetime.
    func recordingStateDidChange() {
        if let pendingPrompt, !isEligible(pendingPrompt) { cancelPrompt() }
        if meetingRecordingID != action.recordingID { meetingRecordingID = nil }
    }

    /// Direct entry for deterministic tests; production consumes the stream.
    func handle(active: Bool) async {
        await dispatch(active: active)?.value
    }

    @discardableResult
    private func dispatch(active: Bool) -> Task<Void, Never>? {
        guard settings.isEnabled, !isSuspended else { settingsDidChange(); return nil }
        guard lastObservedActive != active else { return nil }
        lastObservedActive = active
        cancelPrompt()

        let kind: PromptKind
        if active {
            meetingRecordingID = nil
            kind = .start
        } else {
            guard let recordingID = meetingRecordingID else { return nil }
            kind = .stop(recordingID)
        }
        guard isEligible(kind) else { return nil }
        pendingPrompt = kind
        let currentRevision = revision
        let task = Task<Void, Never> { @MainActor [weak self] in
            await self?.runPrompt(kind, revision: currentRevision)
        }
        promptTask = task
        return task
    }

    private func isEligible(_ kind: PromptKind) -> Bool {
        guard settings.isEnabled, !isSuspended, !action.isBusy else { return false }
        switch kind {
        case .start:
            return lastObservedActive == true && action.state == .idle
        case .stop(let recordingID):
            return lastObservedActive == false && action.state == .recording
                && action.recordingID == recordingID && meetingRecordingID == recordingID
        }
    }

    private func cancelPrompt() {
        revision += 1
        promptTask?.cancel()
        promptTask = nil
        pendingPrompt = nil
        alertPresenter.dismissChoice()
    }

    private func runPrompt(_ kind: PromptKind, revision currentRevision: Int) async {
        guard !Task.isCancelled, revision == currentRevision, isEligible(kind) else { return }
        let confirmed: Bool
        switch kind {
        case .start:
            confirmed = await alertPresenter.presentChoice(
                title: String(localized: "A meeting may be starting"),
                message: String(localized: "Teams is using call audio. Record this conversation when you’re ready."),
                primary: String(localized: "Record"),
                secondary: String(localized: "Later")
            )
        case .stop:
            confirmed = await alertPresenter.presentChoice(
                title: String(localized: "Your meeting may have ended"),
                message: String(localized: "Teams call activity has stopped. Your recording is still running."),
                primary: String(localized: "Stop"),
                secondary: String(localized: "Continue")
            )
        }
        // Drain a transition delivered just as a button was clicked.
        await Task.yield()
        guard !Task.isCancelled, revision == currentRevision else { return }
        pendingPrompt = nil
        promptTask = nil
        guard confirmed, isEligible(kind) else { return }
        switch kind {
        case .start:
            let recordingID = await action.requestStart()
            if revision == currentRevision, settings.isEnabled, lastObservedActive == true {
                meetingRecordingID = recordingID
            }
        case .stop:
            await action.requestStop()
            meetingRecordingID = nil
        }
    }
}
