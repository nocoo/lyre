import Foundation

/// End-of-session snapshot from `AudioCaptureManager.stopCapture()`.
///
/// Recorded on stop so the surrounding stack (RecordingActionController,
/// tests) can post-hoc classify the session — did microphone buffers
/// arrive at all, how long did we run, which input UID did SCK actually
/// use — without inspecting live capture state after it has been torn
/// down.
///
/// Consumed only for non-fatal diagnostics (auto-mic silence warning).
/// The stop success path itself is unaffected: the fileURL is returned
/// even when `micSilenceWarning` is non-nil.
struct CaptureDiagnostics: Equatable, Sendable {
    let micBufferCount: Int
    let systemAudioBufferCount: Int
    let elapsedMs: Int
    /// Whether the session asked SCK to capture microphone in the first
    /// place. Guards against emitting a "no mic audio" warning when the
    /// caller intentionally ran system-audio-only.
    let captureMicrophone: Bool
    /// UID actually handed to `SCStreamConfiguration.microphoneCaptureDeviceID`,
    /// or `nil` when SCK chose internally (`InputDeviceResolver.Source.scPicked`).
    let effectiveDeviceID: String?

    /// Below this many elapsed milliseconds the "no mic audio" warning
    /// is suppressed. macOS 15 SCK microphone tap has a documented cold-
    /// start latency (~480ms; docs/06-macos-audio-pipeline-redesign.md);
    /// a 5s threshold buys enough headroom to avoid false positives from
    /// short taps, accidental stops, and permission dialogs eating the
    /// early buffer window.
    static let minElapsedMsForMicSilenceWarning = 5_000

    /// User-facing warning string, or `nil` when the session looks
    /// healthy or the checks do not apply. Rules (all must hold):
    ///
    /// 1. `captureMicrophone == true` — mic was requested.
    /// 2. `micBufferCount == 0` — zero mic buffers arrived.
    /// 3. `elapsedMs > minElapsedMsForMicSilenceWarning` — session ran
    ///    long enough that first-frame latency alone can't explain the
    ///    silence.
    /// 4. `systemAudioBufferCount > 0` — pipeline was working overall,
    ///    which rules out "entire capture never started". Full-pipeline
    ///    failures already surface via `RecordingError` / stream error.
    var micSilenceWarning: String? {
        guard captureMicrophone else { return nil }
        guard micBufferCount == 0 else { return nil }
        guard elapsedMs > Self.minElapsedMsForMicSilenceWarning else { return nil }
        guard systemAudioBufferCount > 0 else { return nil }

        let deviceLabel = effectiveDeviceID ?? "system default"
        return """
            No microphone audio was captured during this recording. \
            Input device: \(deviceLabel). Check your system input \
            selection or pick a specific device from the tray menu \
            before recording again.
            """
    }
}
