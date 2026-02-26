import Darwin
import Testing
@testable import Lyre

// MARK: - Sanitization

@Test func sanitizeRemovesNaN() {
    let input: [Float] = [0.5, .nan, -0.3]
    let result = AudioMixer.sanitize(input)
    #expect(result == [0.5, 0.0, -0.3])
}

@Test func sanitizeRemovesInfinity() {
    let input: [Float] = [.infinity, -.infinity, 0.1]
    let result = AudioMixer.sanitize(input)
    #expect(result == [0.0, 0.0, 0.1])
}

@Test func sanitizeClampsValues() {
    let input: [Float] = [1.5, -1.5, 0.9]
    let result = AudioMixer.sanitize(input)
    #expect(result == [1.0, -1.0, 0.9])
}

@Test func sanitizeEmptyArray() {
    let result = AudioMixer.sanitize([])
    #expect(result.isEmpty)
}

// MARK: - Soft clipping

@Test func softClipSmallValuesPassThrough() {
    // tanhf(0.3) ≈ 0.2913 — nearly unchanged for small inputs
    let result = AudioMixer.softClip(0.3)
    #expect(abs(result - tanhf(0.3)) < 0.0001)
}

@Test func softClipLargeValuesCompressed() {
    // tanhf(2.0) ≈ 0.9640 — compressed but not clipped
    let result = AudioMixer.softClip(2.0)
    #expect(result < 1.0)
    #expect(result > 0.9)
}

@Test func softClipNegativeValues() {
    let result = AudioMixer.softClip(-1.5)
    #expect(result > -1.0)
    #expect(result < -0.85)
}

// MARK: - Mixing (both sources)

@Test func mixAppliesGainAndSoftClip() {
    let mixer = AudioMixer()
    mixer.systemGain = 0.8
    mixer.micGain = 2.5
    mixer.pushSystemAudio([0.4])
    mixer.pushMicrophone([0.2])
    let output = mixer.drain()
    // expected: softClip(0.4 * 0.8 + 0.2 * 2.5) = softClip(0.32 + 0.5) = softClip(0.82)
    let expected = tanhf(0.82)
    #expect(output.count == 1)
    #expect(abs(output[0] - expected) < 0.001)
}

@Test func mixEqualLengthBuffers() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    mixer.micGain = 1.0
    mixer.pushSystemAudio([0.4, 0.6])
    mixer.pushMicrophone([0.2, 0.4])
    let output = mixer.drain()
    // softClip(0.4+0.2) = tanh(0.6), softClip(0.6+0.4) = tanh(1.0)
    #expect(output.count == 2)
    #expect(abs(output[0] - tanhf(0.6)) < 0.001)
    #expect(abs(output[1] - tanhf(1.0)) < 0.001)
}

@Test func mixUnequalLengthBuffers() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    mixer.micGain = 1.0
    mixer.pushSystemAudio([0.4, 0.6, 0.8])
    mixer.pushMicrophone([0.2])
    let output = mixer.drain()
    // Only 1 overlapping sample
    #expect(output.count == 1)
    #expect(abs(output[0] - tanhf(0.6)) < 0.001)

    // Remaining system buffer: [0.6, 0.8] — below threshold, should not drain
    let output2 = mixer.drain()
    #expect(output2.isEmpty)
}

@Test func mixSoftClipsHighPeaks() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    mixer.micGain = 1.0
    mixer.pushSystemAudio([1.0])
    mixer.pushMicrophone([1.0])
    let output = mixer.drain()
    // softClip(2.0) = tanh(2.0) ≈ 0.964 — compressed, not hard clipped
    let expected = tanhf(2.0)
    #expect(output.count == 1)
    #expect(abs(output[0] - expected) < 0.001)
    #expect(output[0] < 1.0) // Should be compressed below 1.0
}

// MARK: - Single-source drain

@Test func singleSourceSystemDrainsAboveThreshold() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    let samples = [Float](repeating: 0.5, count: AudioMixer.drainThreshold)
    mixer.pushSystemAudio(samples)
    let output = mixer.drain()
    #expect(output.count == AudioMixer.drainThreshold)
    // Each sample should be softClip(0.5 * 1.0) = tanh(0.5)
    #expect(abs(output[0] - tanhf(0.5)) < 0.001)
}

@Test func singleSourceMicDrainsAboveThreshold() {
    let mixer = AudioMixer()
    mixer.micGain = 1.0
    let samples = [Float](repeating: 0.3, count: AudioMixer.drainThreshold)
    mixer.pushMicrophone(samples)
    let output = mixer.drain()
    #expect(output.count == AudioMixer.drainThreshold)
    #expect(abs(output[0] - tanhf(0.3)) < 0.001)
}

@Test func singleSourceBelowThresholdDoesNotDrain() {
    let mixer = AudioMixer()
    let samples = [Float](repeating: 0.5, count: AudioMixer.drainThreshold - 1)
    mixer.pushSystemAudio(samples)
    let output = mixer.drain()
    #expect(output.isEmpty)
}

// MARK: - Flush

@Test func flushMixesRemainingBothSources() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    mixer.micGain = 1.0
    mixer.pushSystemAudio([0.4, 0.6, 0.8])
    mixer.pushMicrophone([0.2])
    let output = mixer.flush()
    // Overlapping: softClip(0.4+0.2)=tanh(0.6), then remainder: softClip(0.6), softClip(0.8)
    #expect(output.count == 3)
    #expect(abs(output[0] - tanhf(0.6)) < 0.001)
    #expect(abs(output[1] - tanhf(0.6)) < 0.001)
    #expect(abs(output[2] - tanhf(0.8)) < 0.001)
}

@Test func flushSingleSourceReturnsAll() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    mixer.pushSystemAudio([0.1, 0.2])
    let output = mixer.flush()
    #expect(output.count == 2)
    #expect(abs(output[0] - tanhf(0.1)) < 0.001)
    #expect(abs(output[1] - tanhf(0.2)) < 0.001)
}

@Test func flushEmptyReturnsEmpty() {
    let mixer = AudioMixer()
    let output = mixer.flush()
    #expect(output.isEmpty)
}

// MARK: - Reset

@Test func resetClearsBothBuffers() {
    let mixer = AudioMixer()
    mixer.pushSystemAudio([0.5])
    mixer.pushMicrophone([0.3])
    mixer.reset()
    let output = mixer.flush()
    #expect(output.isEmpty)
}

// MARK: - Sample count preservation

@Test func twoSecondsAt48kHzPreservesCount() {
    let mixer = AudioMixer()
    mixer.systemGain = 1.0
    mixer.micGain = 1.0
    let sampleRate = 48000
    let duration = 2
    let count = sampleRate * duration
    let sys = [Float](repeating: 0.3, count: count)
    let mic = [Float](repeating: 0.2, count: count)
    mixer.pushSystemAudio(sys)
    mixer.pushMicrophone(mic)

    var totalOutput = 0
    while true {
        let chunk = mixer.drain()
        if chunk.isEmpty { break }
        totalOutput += chunk.count
    }
    let remaining = mixer.flush()
    totalOutput += remaining.count
    #expect(totalOutput == count)
}

// MARK: - Gain configuration

@Test func micGainBoostsMicrophoneSignal() {
    let mixer = AudioMixer()
    mixer.systemGain = 0.0 // mute system to isolate mic
    mixer.micGain = 3.0
    mixer.pushSystemAudio([0.0])
    mixer.pushMicrophone([0.2])
    let output = mixer.drain()
    // softClip(0.0 + 0.2 * 3.0) = tanh(0.6)
    #expect(output.count == 1)
    #expect(abs(output[0] - tanhf(0.6)) < 0.001)
}

@Test func defaultGainValues() {
    let mixer = AudioMixer()
    #expect(mixer.micGain == 2.5)
    #expect(mixer.systemGain == 0.8)
}

@Test func drainThresholdIs9600() {
    #expect(AudioMixer.drainThreshold == 9600)
}
