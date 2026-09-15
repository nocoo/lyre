import AppKit
import Foundation
import os

/// Best-effort, opt-in reminders. Start needs sustained call evidence; ending
/// gets a longer grace period so muting, Space changes and I/O blips stay quiet.
@MainActor
final class TeamsMeetingWatcher: MeetingEventProviding {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "TeamsMeetingWatcher")
    nonisolated static let teamsBundleIDs: Set<String> = ["com.microsoft.teams", "com.microsoft.teams2"]
    static let startConfirmationSeconds: TimeInterval = 10
    static let endConfirmationSeconds: TimeInterval = 30

    let meetingEvents: AsyncStream<Bool>
    private let eventContinuation: AsyncStream<Bool>.Continuation
    private let runningApps: RunningAppsProviding
    private let content: ShareableContentProviding
    private let permissions: RecordingPermissions
    private let audioActivity: TeamsAudioActivityProviding
    private let now: () -> TimeInterval
    private var tickTimer: Timer?
    private var workspaceObservers: [NSObjectProtocol] = []
    private var observationTask: Task<Void, Never>?
    private var generation = 0
    private var isRunning = false
    private var baselineDone = false

    private enum Tier { case cold, warm, hot }
    private var tier: Tier = .cold
    // swiftlint:disable discouraged_optional_boolean
    private var confirmedActive: Bool?
    private var pendingActive: Bool?
    // swiftlint:enable discouraged_optional_boolean
    private var pendingSince: TimeInterval?

    init(
        runningApps: RunningAppsProviding,
        content: ShareableContentProviding,
        permissions: RecordingPermissions,
        audioActivity: TeamsAudioActivityProviding = CoreAudioTeamsAudioActivityProvider(),
        now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.runningApps = runningApps
        self.content = content
        self.permissions = permissions
        self.audioActivity = audioActivity
        self.now = now
        let pair = AsyncStream<Bool>.makeStream(bufferingPolicy: .bufferingNewest(1))
        meetingEvents = pair.stream
        eventContinuation = pair.continuation
    }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        installWorkspaceObservers()
        recomputeTier(runTickImmediately: true)
    }

    func suspend() {
        isRunning = false
        invalidateObservation()
        tickTimer?.invalidate()
        tickTimer = nil
        for observer in workspaceObservers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        workspaceObservers = []
        tier = .cold
        baselineDone = false
        confirmedActive = nil
        handleObservationUnavailable()
    }

    func resume() { start() }

    func stopAndFinish() {
        suspend()
        eventContinuation.finish()
    }

    private func installWorkspaceObservers() {
        guard workspaceObservers.isEmpty else { return }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            workspaceObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                      let bundleID = app.bundleIdentifier, Self.teamsBundleIDs.contains(bundleID) else { return }
                Task { @MainActor in
                    guard let self, self.isRunning else { return }
                    self.recomputeTier(runTickImmediately: true)
                }
            })
        }
    }

    private func invalidateObservation() {
        generation += 1
        observationTask?.cancel()
        observationTask = nil
    }

    private func recomputeTier(runTickImmediately: Bool) {
        let alive = runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs)
        if alive {
            tier = confirmedActive == true ? .hot : .warm
        } else {
            tier = .cold
            invalidateObservation()
            if confirmedActive == true { eventContinuation.yield(false) }
            confirmedActive = false
            // Establish an idle baseline even when Teams was not running at launch.
            baselineDone = true
            handleObservationUnavailable()
        }
        rescheduleTimer()
        if runTickImmediately { tick() }
    }

    private func rescheduleTimer() {
        guard isRunning else { return }
        tickTimer?.invalidate()
        tickTimer = Timer.scheduledTimer(withTimeInterval: tier == .cold ? 30 : 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard isRunning else { return }
        if tier == .cold {
            if runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs) {
                recomputeTier(runTickImmediately: true)
            }
            return
        }
        guard observationTask == nil else { return }
        let currentGeneration = generation
        observationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.observe(generation: currentGeneration)
            if self.generation == currentGeneration { self.observationTask = nil }
        }
    }

    private func observationIsCurrent(_ expectedGeneration: Int) -> Bool {
        !Task.isCancelled && isRunning && generation == expectedGeneration
    }

    private func observe(generation expectedGeneration: Int) async {
        guard observationIsCurrent(expectedGeneration) else { return }
        guard runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs) else {
            recomputeTier(runTickImmediately: false)
            return
        }
        let audio = audioActivity.activity(for: Self.teamsBundleIDs)
        if audio?.isDuplex == true {
            applyDebounced(rawActive: true)
            return
        }
        await permissions.checkAll()
        guard observationIsCurrent(expectedGeneration) else { return }
        guard permissions.screenCaptureGranted else { handleObservationUnavailable(); return }
        await observeWindows(audio: audio, generation: expectedGeneration)
    }

    private func observeWindows(audio: TeamsAudioActivity?, generation expectedGeneration: Int) async {
        do {
            let windows = try await content.currentTeamsWindows(bundleIDs: Self.teamsBundleIDs)
            guard observationIsCurrent(expectedGeneration) else { return }
            guard runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs) else {
                recomputeTier(runTickImmediately: false)
                return
            }
            guard let audio else { handleObservationUnavailable(); return }
            let meetingWindow = Self.judgeMeeting(from: windows)
            if confirmedActive == true {
                applyDebounced(rawActive: audio.isRunning || meetingWindow)
            } else {
                // A mic preview, two chat windows or an idle meeting title
                // alone cannot start a new meeting cycle.
                applyDebounced(rawActive: audio.isRunning && meetingWindow)
            }
        } catch {
            guard observationIsCurrent(expectedGeneration) else { return }
            permissions.reportScreenCaptureFailure(error)
            Self.logger.debug("Meeting observation unavailable: \(error.localizedDescription)")
            handleObservationUnavailable()
        }
    }

    private func handleObservationUnavailable() {
        pendingActive = nil
        pendingSince = nil
    }

    /// Window count carries no meeting evidence. Offscreen meeting windows
    /// still count: moving to another Space or minimizing is not ending a call.
    static func judgeMeeting(from windows: [ShareableWindow]) -> Bool {
        windows.contains {
            teamsBundleIDs.contains($0.bundleID) && $0.frame.width >= 200 && $0.frame.height >= 200
                && isMeetingTitle($0.title)
        }
    }

    static func isMeetingTitle(_ title: String?) -> Bool {
        let lower = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let suffix = " | microsoft teams"
        guard lower.hasSuffix(suffix) else { return false }
        let head = String(lower.dropLast(suffix.count))
        guard !head.contains(" | ") else { return false }
        if ["meeting", "会议", "會議", "会议中"].contains(head) { return true }
        if head.hasPrefix("meeting in "), head.count > "meeting in ".count { return true }
        return head.hasSuffix("'s meeting") && head.count > "'s meeting".count
    }

    private func applyDebounced(rawActive: Bool) {
        if !baselineDone {
            baselineDone = true
            confirmedActive = rawActive
            tier = rawActive ? .hot : .warm
            rescheduleTimer()
            return
        }
        guard confirmedActive != rawActive else { handleObservationUnavailable(); return }
        let instant = now()
        if pendingActive != rawActive || pendingSince == nil {
            pendingActive = rawActive
            pendingSince = instant
            return
        }
        let required = rawActive ? Self.startConfirmationSeconds : Self.endConfirmationSeconds
        guard let pendingSince, instant - pendingSince >= required else { return }
        confirmedActive = rawActive
        handleObservationUnavailable()
        eventContinuation.yield(rawActive)
        recomputeTier(runTickImmediately: false)
    }

    #if DEBUG
    func testingSubmit(rawActive: Bool) { applyDebounced(rawActive: rawActive) }
    func testingRecomputeTier() { recomputeTier(runTickImmediately: false) }
    func testingHandleObservationUnavailable() { handleObservationUnavailable() }
    func testingTick() async { tick(); await observationTask?.value }
    // swiftlint:disable:next discouraged_optional_boolean
    var testingConfirmedActive: Bool? { confirmedActive }
    #endif
}
