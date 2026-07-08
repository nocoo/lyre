import AppKit
import Foundation
import os
import ScreenCaptureKit

// Test seams (`RunningAppsProviding`, `ShareableContentProviding`,
// `MeetingEventProviding`) and their production adapters live in
// `MeetingProviders.swift` alongside this file.

// MARK: - Watcher

/// Cold-warm-hot polling watcher that publishes debounced Teams meeting state
/// on `meetingEvents`. Contract & rationale live in
/// `docs/07-teams-meeting-detector.md`.
@MainActor
final class TeamsMeetingWatcher: MeetingEventProviding {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "TeamsMeetingWatcher")

    // MARK: - Public

    /// Emits only *debounced, confirmed* transitions. Baseline is silent.
    /// `.bufferingNewest(1)` so long-running alerts do not stack stale events.
    let meetingEvents: AsyncStream<Bool>

    // MARK: - Constants (v1.3 judgement contract)

    // `teamsBundleIDs` is read from NSWorkspace observer closures that the
    // system marks `@Sendable`; keep it nonisolated so the compiler can see
    // the access is safe. The value is immutable so this is trivially OK.
    nonisolated static let teamsBundleIDs: Set<String> = [
        "com.microsoft.teams",   // Classic
        "com.microsoft.teams2",  // New Teams
    ]
    static let meetingTitleSuffix: String = " | microsoft teams"
    static let meetingHeadPrefixEnglish: String = "meeting"
    static let meetingHeadSuffixEnglish: String = "'s meeting"
    static let meetingHeadExact: Set<String> = ["meeting", "会议", "會議", "会议中"]
    static let excludedTitles: Set<String> = [
        "microsoft teams", "settings", "设置", "preferences", "",
        "teams nrc", "select a certificate for authentication",
    ]
    static let minCandidateWidth: CGFloat = 200
    static let minCandidateHeight: CGFloat = 200

    private let coldInterval: TimeInterval = 30
    private let warmInterval: TimeInterval = 5

    // MARK: - Dependencies

    private let runningApps: RunningAppsProviding
    private let content: ShareableContentProviding
    private let permissions: RecordingPermissions
    private let audioActivity: TeamsAudioActivityProviding

    // MARK: - Internal state

    private let eventContinuation: AsyncStream<Bool>.Continuation
    private var tickTimer: Timer?
    private var launchObserver: NSObjectProtocol?
    private var terminateObserver: NSObjectProtocol?

    private enum Tier { case cold, warm, hot }
    private var tier: Tier = .cold

    // The two `Bool?`s below use nil deliberately to distinguish "no
    // observation yet" from "observed false"; that tri-state is what powers
    // baseline silence and two-tick debounce.
    // swiftlint:disable:next discouraged_optional_boolean
    private var confirmedActive: Bool?
    // swiftlint:disable:next discouraged_optional_boolean
    private var lastRawJudgement: Bool?
    private var baselineDone: Bool = false
    private var sckUnauthorizedLogged: Bool = false

    // MARK: - Init

    init(
        runningApps: RunningAppsProviding,
        content: ShareableContentProviding,
        permissions: RecordingPermissions,
        audioActivity: TeamsAudioActivityProviding = CoreAudioTeamsAudioActivityProvider()
    ) {
        self.runningApps = runningApps
        self.content = content
        self.permissions = permissions
        self.audioActivity = audioActivity

        var continuation: AsyncStream<Bool>.Continuation?
        self.meetingEvents = AsyncStream<Bool>(bufferingPolicy: .bufferingNewest(1)) {
            continuation = $0
        }
        // swiftlint:disable:next force_unwrapping
        self.eventContinuation = continuation!
    }

    // MARK: - Lifecycle

    /// First bring-up. Installs the NSWorkspace observers, computes the tier,
    /// and kicks off the baseline tick. Paired with `stopAndFinish()`.
    func start() {
        installWorkspaceObservers()
        recomputeTier(runTickImmediately: true)
    }

    /// Pause without teardown: cancels the timer, removes observers, and
    /// clears baseline / debounce state. The AsyncStream continuation is
    /// **not** finished — `for await` consumers stay parked until `resume()`.
    /// Used when the user flips the detector off in Settings.
    func suspend() {
        tickTimer?.invalidate()
        tickTimer = nil
        if let obs = launchObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
        }
        if let obs = terminateObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
        }
        launchObserver = nil
        terminateObserver = nil
        tier = .cold
        baselineDone = false
        lastRawJudgement = nil
        confirmedActive = nil
        sckUnauthorizedLogged = false
    }

    /// Resume from a suspended state. Equivalent to a fresh `start()`.
    func resume() { start() }

    /// Permanent teardown: `suspend()` + finish the stream so consumers exit.
    func stopAndFinish() {
        suspend()
        eventContinuation.finish()
    }

    // MARK: - NSWorkspace observers

    private func installWorkspaceObservers() {
        // Idempotent: `start()`/`resume()` may be called on an already-armed
        // watcher (e.g. user rapidly toggles the Settings switch). Without
        // this guard the previous NSObjectProtocol tokens are overwritten
        // and the underlying observers leak until process exit.
        guard launchObserver == nil, terminateObserver == nil else { return }
        let center = NSWorkspace.shared.notificationCenter
        launchObserver = center.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bid = app.bundleIdentifier,
                  Self.teamsBundleIDs.contains(bid) else { return }
            Task { @MainActor in self?.recomputeTier(runTickImmediately: true) }
        }
        terminateObserver = center.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bid = app.bundleIdentifier,
                  Self.teamsBundleIDs.contains(bid) else { return }
            Task { @MainActor in self?.recomputeTier(runTickImmediately: false) }
        }
    }

    // MARK: - Tier control

    private func recomputeTier(runTickImmediately: Bool) {
        let teamsAlive = runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs)
        let newTier: Tier
        if teamsAlive {
            newTier = (confirmedActive == true) ? .hot : .warm
        } else {
            newTier = .cold
            // Teams disappeared → any prior "in meeting" state is stale.
            // Emit a false transition so the coordinator can dismiss / offer
            // the stop prompt path; then reset debounce state.
            if confirmedActive == true {
                confirmedActive = false
                eventContinuation.yield(false)
            } else {
                confirmedActive = false
            }
            lastRawJudgement = false
        }
        tier = newTier
        rescheduleTimer()
        if runTickImmediately {
            Task { @MainActor in self.tick() }
        }
    }

    private func rescheduleTimer() {
        tickTimer?.invalidate()
        let interval = (tier == .cold) ? coldInterval : warmInterval
        tickTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    // MARK: - Tick

    private func tick() {
        switch tier {
        case .cold:
            if runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs) {
                recomputeTier(runTickImmediately: true)
            }
        case .warm, .hot:
            Task { @MainActor in await checkTeamsWindows() }
        }
    }

    private func checkTeamsWindows() async {
        // Primary signal: CoreAudio process-tap. Robust across Space
        // switches, minimized windows, all-day meeting scenarios, and Teams
        // title changes — none of those affect whether Teams holds the mic.
        // See docs/07 v2.0 rationale.
        if audioActivity.isBundleUsingInput(anyOf: Self.teamsBundleIDs) == true {
            applyDebounced(rawActive: true)
            return
        }
        // Audio signal returned false or nil → fall back to the window
        // heuristic. This covers the "Teams meeting in progress but mic is
        // muted" edge case where a browser-hosted call drops mic input
        // entirely (native Teams keeps it — but be defensive), and the
        // rare macOS < 14.4 fallback (Lyre targets 15+ so unreachable in
        // production, but the provider returns nil in that branch).
        //
        // SCK not granted → stay inactive silently, log at most once per
        // watcher lifetime. Deliberately does NOT feed the debounce channel:
        // a transient permission gap must not become a meeting-ended event
        // that would trigger the coordinator's Stop prompt. See
        // docs/07 (SCK unauthorized contract) + DQ-7.
        guard permissions.screenCaptureGranted else {
            if !sckUnauthorizedLogged {
                Self.logger.info("Screen Recording not granted; detector stays inactive")
                sckUnauthorizedLogged = true
            }
            handleObservationUnavailable()
            return
        }
        do {
            let windows = try await content.currentTeamsWindows(bundleIDs: Self.teamsBundleIDs)
            applyDebounced(rawActive: Self.judgeMeeting(from: windows))
        } catch {
            // Best-effort: treat SCK query failure the same way as missing
            // permission — silent, and specifically not a false transition.
            Self.logger.warning("SCK query failed: \(error.localizedDescription)")
            handleObservationUnavailable()
        }
    }

    /// Called when we cannot observe the current SCK state (permission
    /// missing / API failure). Resets the raw-judgement history so that the
    /// next authorised tick starts fresh, but preserves `confirmedActive`
    /// and never yields — the coordinator must not see this as a meeting
    /// transition.
    private func handleObservationUnavailable() {
        lastRawJudgement = nil
        // baselineDone stays true: we still know the last confirmed state,
        // we're just refusing to advance it while blind. confirmedActive is
        // deliberately untouched so the tray / logs can still reflect the
        // last real observation.
    }

    // MARK: - Judgement (v1.3 contract, pure)

    /// See docs/07-teams-meeting-detector.md — the v1.3 heuristic requires
    /// on-screen + adequately sized candidates before applying either the
    /// count rule or the title-slot rule.
    static func judgeMeeting(from windows: [ShareableWindow]) -> Bool {
        let candidates = windows.filter { win in
            let title = (win.title ?? "").lowercased()
            guard !excludedTitles.contains(title) else { return false }
            guard win.isOnScreen else { return false }
            guard win.frame.width >= minCandidateWidth,
                  win.frame.height >= minCandidateHeight else { return false }
            return true
        }
        if candidates.count >= 2 { return true }
        for win in candidates where isMeetingTitle(win.title) {
            return true
        }
        return false
    }

    /// v1.3 title-slot rule: title must end in `meetingTitleSuffix` and the
    /// pre-suffix head (split on " | ") must look like a meeting subject.
    static func isMeetingTitle(_ title: String?) -> Bool {
        let lower = (title ?? "").lowercased()
        guard lower.hasSuffix(meetingTitleSuffix) else { return false }
        let head = String(
            lower.split(separator: " | ", maxSplits: 1, omittingEmptySubsequences: false)
                .first ?? ""
        )
        if meetingHeadExact.contains(head) { return true }
        if head.hasPrefix(meetingHeadPrefixEnglish) { return true }
        if head.hasSuffix(meetingHeadSuffixEnglish) { return true }
        return false
    }

    // MARK: - Debounce + baseline

    private func applyDebounced(rawActive: Bool) {
        if !baselineDone {
            // Baseline: seed internal state so we know the *current* value
            // but never surface it as a transition — startup should not
            // pop a prompt for a meeting already in progress.
            confirmedActive = rawActive
            lastRawJudgement = rawActive
            baselineDone = true
            if rawActive {
                // Move to hot without recording a transition — no yield.
                tier = .hot
                rescheduleTimer()
            }
            return
        }
        // Two consecutive raw ticks with the same value flip confirmedActive.
        if lastRawJudgement == rawActive, confirmedActive != rawActive {
            confirmedActive = rawActive
            eventContinuation.yield(rawActive)
            recomputeTier(runTickImmediately: false)
        }
        lastRawJudgement = rawActive
    }

    // MARK: - Test hooks

    #if DEBUG
    /// Feed one raw judgement into the debounce state machine. Test-only
    /// affordance to exercise judgement/debounce without spinning a Timer.
    @MainActor
    func testingSubmit(rawActive: Bool) {
        applyDebounced(rawActive: rawActive)
    }

    /// Test-only: recompute the tier as if an NSWorkspace notification just
    /// fired. Lets tests exercise the "Teams process terminated" path
    /// without spinning up a real NSRunningApplication.
    @MainActor
    func testingRecomputeTier() {
        recomputeTier(runTickImmediately: false)
    }

    /// Test-only: exercise the observation-unavailable branch (SCK denied /
    /// SCK provider throws) without going through `checkTeamsWindows()`.
    @MainActor
    func testingHandleObservationUnavailable() {
        handleObservationUnavailable()
    }

    @MainActor
    // swiftlint:disable:next discouraged_optional_boolean
    var testingConfirmedActive: Bool? { confirmedActive }

    @MainActor
    var testingTier: String { String(describing: tier) }
    #endif
}
