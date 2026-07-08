import Foundation
import Observation
import os

/// Coordinator-facing contract for driving recordings. Kept intentionally
/// narrow so `MeetingPromptCoordinator` (and future integrations) can be
/// tested with a fake action handler without touching `RecordingManager`.
@MainActor
protocol RecordingActionHandling: AnyObject {
    var state: RecordingManager.State { get }
    func requestStart() async
    func requestStop() async
}

/// Single entry point for starting / stopping a recording from the tray menu
/// **and** the meeting prompt coordinator. Previously tray code owned the
/// elapsed timer + the `RecordingsStore.refresh(url:)` call inline, so any
/// non-tray caller would silently skip those side effects. This controller
/// owns them so that all callers see identical UI updates.
///
/// TrayMenu depends on the concrete `RecordingActionController` (as
/// `@Bindable`) to pick up SwiftUI observation of `state` and `elapsedDisplay`.
/// The coordinator only sees the narrow `RecordingActionHandling` protocol.
@Observable
@MainActor
final class RecordingActionController: RecordingActionHandling {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "RecordingActionController")

    private let recorder: RecordingLifecycleManaging
    /// Mutable so `LyreApp` can swap it when the output directory changes
    /// (`RecordingsStore` is per-directory, not global). Without this, stop
    /// would refresh the stale store and the UI would miss the new file.
    private var recordingsStore: RecordingsRefreshing
    private let alertPresenter: AlertPresenting

    /// Own tracked, stored state so SwiftUI's `@Observable` diffing fires
    /// on the tray whenever start/stop transitions. Reading `recorder.state`
    /// as a computed proxy defeats observation because the proxy is not
    /// registered with the tracking runtime.
    private(set) var state: RecordingManager.State
    /// Human-readable `mm:ss` string driven by the elapsed timer. TrayMenu
    /// reads this directly instead of holding a private timer.
    private(set) var elapsedDisplay: String = "00:00"
    private var elapsedTimer: Timer?

    init(
        recorder: RecordingLifecycleManaging,
        recordingsStore: RecordingsRefreshing,
        alertPresenter: AlertPresenting
    ) {
        self.recorder = recorder
        self.recordingsStore = recordingsStore
        self.alertPresenter = alertPresenter
        self.state = recorder.state
    }

    /// Swap the store target used for post-stop refresh. Called from
    /// `LyreApp` when the user changes the output directory.
    func setRecordingsStore(_ store: RecordingsRefreshing) {
        self.recordingsStore = store
    }

    func requestStart() async {
        // Defensive: coordinator + tray tapping at the same time must not
        // double-start. `RecordingManager.startRecording()` also guards, but
        // we swallow the redundant call here to avoid a bogus alert.
        guard state == .idle else { return }
        do {
            try await recorder.startRecording()
            state = .recording
            startElapsedTimer()
        } catch {
            Self.logger.error("Start failed: \(error.localizedDescription)")
            alertPresenter.presentError(
                title: "Recording Failed",
                message: error.localizedDescription
            )
        }
    }

    func requestStop() async {
        guard state == .recording else { return }
        stopElapsedTimer()
        do {
            let url = try await recorder.stopRecording()
            state = .idle
            await recordingsStore.refresh(url: url)
            // Non-fatal diagnostic surface. Stop success is not
            // affected by this — the fileURL is already returned and
            // the store already refreshed above. If the capture
            // manager detected mic-silence (mic requested but zero
            // buffers arrived while system audio did), tell the user
            // so they can pick a working input before the next take.
            if let warning = recorder.lastCaptureDiagnostics?.micSilenceWarning {
                Self.logger.warning("Post-stop mic silence detected: \(warning)")
                alertPresenter.presentError(
                    title: "Microphone Not Captured",
                    message: warning
                )
            }
        } catch {
            // Even on error the recorder path resets its own state; mirror
            // that here so the UI does not stay stuck in `.recording`.
            state = recorder.state
            Self.logger.error("Stop failed: \(error.localizedDescription)")
            alertPresenter.presentError(
                title: "Recording Error",
                message: error.localizedDescription
            )
        }
    }

    // MARK: - Elapsed timer

    private func startElapsedTimer() {
        elapsedDisplay = "00:00"
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateElapsedDisplay() }
        }
    }

    private func stopElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        elapsedDisplay = "00:00"
    }

    private func updateElapsedDisplay() {
        // Detect a stream-error recovery in RecordingManager: it can flip
        // its own `state` back to `.idle` without going through the
        // controller (see RecordingManager.handleStreamError). If that
        // happens, our stored `state` would stay stuck at `.recording`,
        // leaving the tray menu showing "Stop Recording" while the tray
        // icon (which reads recorder.state directly) shows idle. Detect
        // the divergence here and converge.
        if recorder.state == .idle && state == .recording {
            Self.logger.warning("Recorder state diverged (idle) — mirroring and tearing down timer")
            stopElapsedTimer()
            state = .idle
            return
        }
        let seconds = Int(recorder.elapsedSeconds)
        elapsedDisplay = String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    #if DEBUG
    /// Test hook: run one iteration of the elapsed-timer callback. Lets
    /// tests exercise the divergence-detection path in
    /// `updateElapsedDisplay()` without waiting a real second.
    func testingForceElapsedTick() { updateElapsedDisplay() }
    #endif
}
