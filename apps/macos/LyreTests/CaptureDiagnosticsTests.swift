import Testing
@testable import Lyre

@Suite("CaptureDiagnostics Tests")
struct CaptureDiagnosticsTests {
    private func make(
        mic: Int,
        system: Int,
        elapsedMs: Int,
        captureMic: Bool = true,
        effective: String? = "built-in-uid"
    ) -> CaptureDiagnostics {
        CaptureDiagnostics(
            micBufferCount: mic,
            systemAudioBufferCount: system,
            elapsedMs: elapsedMs,
            captureMicrophone: captureMic,
            effectiveDeviceID: effective
        )
    }

    @Test func healthySessionEmitsNoWarning() {
        let diag = make(mic: 1234, system: 4321, elapsedMs: 12_000)
        #expect(diag.micSilenceWarning == nil)
    }

    @Test func micSilenceWithLongSessionAndSystemAudioTriggersWarning() {
        let diag = make(mic: 0, system: 500, elapsedMs: 10_000)
        let warning = diag.micSilenceWarning
        #expect(warning != nil)
        #expect(warning?.contains("built-in-uid") == true)
    }

    @Test func micSilenceInShortSessionIsSuppressed() {
        // 3s session — inside the 5s cold-start grace window.
        let diag = make(mic: 0, system: 100, elapsedMs: 3_000)
        #expect(diag.micSilenceWarning == nil)
    }

    @Test func micSilenceAtExactThresholdIsSuppressed() {
        // Threshold is `> 5000`, not `>=`, so exactly 5000ms should not
        // trigger. Guards against off-by-one regressions.
        let diag = make(mic: 0, system: 100, elapsedMs: 5_000)
        #expect(diag.micSilenceWarning == nil)
    }

    @Test func micSilenceJustAboveThresholdTriggers() {
        let diag = make(mic: 0, system: 100, elapsedMs: 5_001)
        #expect(diag.micSilenceWarning != nil)
    }

    @Test func micSilenceWithZeroSystemAudioIsSuppressed() {
        // Zero system audio + zero mic + long elapsed = whole capture
        // pipeline failed. That is not a "mic device" problem, so the
        // mic-specific warning must not fire — the underlying failure
        // will surface through `RecordingError` or a stream-error alert
        // instead.
        let diag = make(mic: 0, system: 0, elapsedMs: 30_000)
        #expect(diag.micSilenceWarning == nil)
    }

    @Test func systemAudioOnlySessionIsSuppressed() {
        // Caller opted out of microphone capture entirely; zero mic
        // buffers is expected and must not trigger the warning.
        let diag = make(
            mic: 0,
            system: 500,
            elapsedMs: 15_000,
            captureMic: false
        )
        #expect(diag.micSilenceWarning == nil)
    }

    @Test func warningIncludesSystemDefaultLabelWhenEffectiveUIDIsNil() {
        // `.scPicked` path — resolver could not find a UID, SCK chose
        // internally. We still want a warning, but the message should
        // fall back to "system default" rather than showing "nil".
        let diag = make(
            mic: 0,
            system: 500,
            elapsedMs: 10_000,
            effective: nil
        )
        let warning = diag.micSilenceWarning
        #expect(warning != nil)
        #expect(warning?.contains("system default") == true)
        #expect(warning?.contains("nil") == false)
    }
}
