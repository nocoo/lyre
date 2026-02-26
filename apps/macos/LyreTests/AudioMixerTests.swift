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

// MARK: - Mixing (both sources)

@Test func mixEqualLengthBuffers() {
    let mixer = AudioMixer()
    mixer.pushSystemAudio([0.4, 0.6])
    mixer.pushMicrophone([0.2, 0.4])
    let output = mixer.drain()
    // (0.4+0.2)*0.5 = 0.3, (0.6+0.4)*0.5 = 0.5
    #expect(output.count == 2)
    #expect(abs(output[0] - 0.3) < 0.001)
    #expect(abs(output[1] - 0.5) < 0.001)
}

@Test func mixUnequalLengthBuffers() {
    let mixer = AudioMixer()
    mixer.pushSystemAudio([0.4, 0.6, 0.8])
    mixer.pushMicrophone([0.2])
    let output = mixer.drain()
    // Only 1 overlapping sample: (0.4+0.2)*0.5 = 0.3
    #expect(output.count == 1)
    #expect(abs(output[0] - 0.3) < 0.001)

    // Remaining system buffer: [0.6, 0.8] — below threshold, should not drain
    let output2 = mixer.drain()
    #expect(output2.isEmpty)
}

@Test func mixClampsPeaks() {
    let mixer = AudioMixer()
    mixer.pushSystemAudio([1.0])
    mixer.pushMicrophone([1.0])
    let output = mixer.drain()
    // (1.0+1.0)*0.5 = 1.0 — exactly at limit
    #expect(output == [1.0])
}

// MARK: - Single-source drain

@Test func singleSourceSystemDrainsAboveThreshold() {
    let mixer = AudioMixer()
    let samples = [Float](repeating: 0.5, count: AudioMixer.drainThreshold)
    mixer.pushSystemAudio(samples)
    let output = mixer.drain()
    #expect(output.count == AudioMixer.drainThreshold)
}

@Test func singleSourceMicDrainsAboveThreshold() {
    let mixer = AudioMixer()
    let samples = [Float](repeating: 0.3, count: AudioMixer.drainThreshold)
    mixer.pushMicrophone(samples)
    let output = mixer.drain()
    #expect(output.count == AudioMixer.drainThreshold)
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
    mixer.pushSystemAudio([0.4, 0.6, 0.8])
    mixer.pushMicrophone([0.2])
    let output = mixer.flush()
    // Overlapping: (0.4+0.2)*0.5 = 0.3, then remainder: 0.6, 0.8
    #expect(output.count == 3)
    #expect(abs(output[0] - 0.3) < 0.001)
    #expect(abs(output[1] - 0.6) < 0.001)
    #expect(abs(output[2] - 0.8) < 0.001)
}

@Test func flushSingleSourceReturnsAll() {
    let mixer = AudioMixer()
    mixer.pushSystemAudio([0.1, 0.2])
    let output = mixer.flush()
    #expect(output == [0.1, 0.2])
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
