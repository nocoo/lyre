import Foundation
import os

/// Consumes the debounced meeting-state stream from a `MeetingEventProviding`
/// (typically `TeamsMeetingWatcher`) and decides whether to pop the
/// Start-Recording or Stop-Recording prompt through `AlertPresenting`. All
/// side effects on the recording pipeline itself go through
/// `RecordingActionHandling` so tray + coordinator share one entry point.
///
/// Contract summary (see `docs/07-teams-meeting-detector.md`):
/// * Baseline state is silent — the stream never yields it.
/// * `settings.isEnabled == false` swallows in-flight events, but the
///   watcher lifecycle is owned by `LyreApp`, not here.
/// * Only one alert is on screen at a time; new events during a prompt are
///   dropped (upstream `.bufferingNewest(1)` guarantees we never queue
///   stale ones). NSAlert.runModal runs a nested RunLoop that keeps
///   draining MainActor tasks, so the stream consumer keeps reading events
///   during a modal and the `isPromptPresented` gate must be observable to
///   them; that is why dispatch happens synchronously (gate flipped before
///   we spawn the modal task) rather than inside a blocking `await`.
/// * Per-meeting suppression: one Start prompt and one Stop prompt per
///   meeting cycle, no more.
@MainActor
final class MeetingPromptCoordinator {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "MeetingPromptCoordinator")

    private let watcher: MeetingEventProviding
    private let action: RecordingActionHandling
    private let alertPresenter: AlertPresenting
    private let settings: MeetingDetectionSettings

    private var consumeTask: Task<Void, Never>?
    /// True while an NSAlert is on screen (or scheduled to appear in the
    /// current sync dispatch). Set synchronously in `dispatch(active:)` so
    /// any event that arrives before the modal Task begins is still gated,
    /// and cleared by the modal Task's `defer`.
    private var isPromptPresented: Bool = false
    /// Per-meeting suppression flags. Reset only when we observe a
    /// `false → true` transition into a *new* meeting cycle.
    private var startPromptShownForCurrentMeeting: Bool = false
    private var stopPromptShownForCurrentMeeting: Bool = false
    // The last event value we observed, so we can distinguish a real
    // `false → true` transition from a stray repeated `true` (upstream
    // should collapse these but the coordinator must be defensive).
    // swiftlint:disable:next discouraged_optional_boolean
    private var lastObservedActive: Bool?

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

    /// Begin consuming the meeting-state stream. Idempotent: calling twice
    /// only leaves one consumer alive.
    ///
    /// The consumer body is deliberately synchronous with respect to the
    /// modal: `dispatch` returns immediately after flipping the reentrance
    /// gate and launching a child Task to run the prompt. That way the
    /// consumer keeps iterating while a modal is on screen, and any
    /// event that arrives during the modal is dropped by the gate rather
    /// than sitting in `.bufferingNewest(1)` until the modal returns —
    /// which would otherwise land as a Stop prompt right after a Start
    /// (DQ-8 in docs/07-teams-meeting-detector.md).
    func start() {
        consumeTask?.cancel()
        consumeTask = Task { @MainActor [weak self] in
            guard let stream = self?.watcher.meetingEvents else { return }
            for await active in stream {
                self?.dispatch(active: active)
            }
        }
    }

    /// Stop consuming (does not touch the underlying stream itself). Safe to
    /// call repeatedly; used by `LyreApp` on app teardown.
    func stop() {
        consumeTask?.cancel()
        consumeTask = nil
    }

    /// Convenience wrapper for tests that want to drive the state machine
    /// without spinning up the `AsyncStream` consumer task. Production
    /// callers always go through `start()`.
    @MainActor
    func handle(active: Bool) async {
        guard let kind = evaluate(active: active) else { return }
        // Gate was flipped synchronously by evaluate(); await the prompt
        // task so tests observe alert side effects before assertions run.
        await runPrompt(kind)
    }

    // MARK: - Dispatch (synchronous)

    private enum PromptKind {
        case start
        case stop
    }

    /// Called synchronously from the stream consumer. Advances the internal
    /// state machine and, if a prompt is warranted, flips the reentrance
    /// gate + launches an async Task to run the modal.
    private func dispatch(active: Bool) {
        guard let kind = evaluate(active: active) else { return }
        Task { @MainActor [weak self] in
            await self?.runPrompt(kind)
        }
    }

    /// Combined off-switch, reentrance, per-meeting suppression and gating
    /// check. Flips `isPromptPresented` **synchronously** when it returns
    /// a non-nil kind, so any event that races into the consumer before
    /// the modal Task starts is dropped by the gate.
    private func evaluate(active: Bool) -> PromptKind? {
        // Off-switch: honour it inside the handler so watcher lifecycle
        // stays owned by LyreApp. Even when disabled, keep
        // `lastObservedActive` current so re-enabling mid-meeting will not
        // spuriously replay the last transition as a "new" one.
        guard settings.isEnabled else {
            lastObservedActive = active
            return nil
        }
        // Reentrance guard: an alert is on screen or scheduled to appear.
        // Drop the *prompt* side-effect for this event, but still record
        // the observation so the next `false → true` transition is
        // recognised as a new meeting cycle. Without this update, a
        // `false` yielded during a Start prompt would be dropped silently
        // and `lastObservedActive` would stay `true`; then the next real
        // `true` (a genuinely new meeting) would not reset the
        // per-meeting suppression flags and the Start prompt would be
        // wrongly suppressed for the rest of the process lifetime.
        guard !isPromptPresented else {
            lastObservedActive = active
            return nil
        }

        // Only reset per-meeting suppression on a genuine `false → true`
        // transition into a fresh meeting. A repeated `true` (should not
        // happen through the debounced watcher, but be defensive) must not
        // re-arm the Start prompt.
        let isNewMeetingStart = active && (lastObservedActive ?? false) == false
        if isNewMeetingStart {
            startPromptShownForCurrentMeeting = false
            stopPromptShownForCurrentMeeting = false
        }
        lastObservedActive = active

        let kind: PromptKind?
        if active {
            kind = evaluateStart()
        } else {
            kind = evaluateEnd()
        }
        if kind != nil {
            isPromptPresented = true
        }
        return kind
    }

    private func evaluateStart() -> PromptKind? {
        guard action.state == .idle else { return nil }
        guard !startPromptShownForCurrentMeeting else { return nil }
        startPromptShownForCurrentMeeting = true
        return .start
    }

    private func evaluateEnd() -> PromptKind? {
        guard action.state == .recording else { return nil }
        guard !stopPromptShownForCurrentMeeting else { return nil }
        stopPromptShownForCurrentMeeting = true
        return .stop
    }

    // MARK: - Prompts (async)

    private func runPrompt(_ kind: PromptKind) async {
        switch kind {
        case .start:
            let confirmed = alertPresenter.presentChoice(
                title: String(localized: "Teams meeting detected"),
                message: String(localized: "Start recording this meeting?"),
                primary: String(localized: "Start Recording"),
                secondary: String(localized: "Not now")
            )
            if confirmed {
                await action.requestStart()
            } else {
                Self.logger.info("User dismissed Start prompt for this meeting")
            }
        case .stop:
            let confirmed = alertPresenter.presentChoice(
                title: String(localized: "Teams meeting ended"),
                message: String(localized: "Stop recording?"),
                primary: String(localized: "Stop Recording"),
                secondary: String(localized: "Keep Recording")
            )
            if confirmed {
                await action.requestStop()
            } else {
                Self.logger.info("User chose to keep recording after meeting ended")
            }
        }
        // Give the stream consumer at least one MainActor scheduling turn to
        // drain any event that was yielded into the stream *during* the
        // modal (fake or NSAlert). Those buffered events must observe
        // `isPromptPresented == true` and be dropped by the gate; without
        // this yield, a prompt path whose `await`s do not actually suspend
        // (a fast-returning fake, or a real recorder call that completes
        // synchronously) can clear the gate before the consumer runs, and
        // the stale event slips through as a follow-up prompt (DQ-8).
        await Task.yield()
        isPromptPresented = false
    }
}
