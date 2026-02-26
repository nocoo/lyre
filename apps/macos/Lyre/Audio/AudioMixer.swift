import Foundation

/// Mixes two audio streams (system audio + microphone) into a single output.
///
/// Designed for the meeting recording use case where system audio carries
/// other participants' voices and the microphone carries the local user's voice.
///
/// Mixing strategy:
/// - Accumulates samples from each source into separate buffers.
/// - When both buffers have data, mixes overlapping samples via averaging:
///   `(a + b) * 0.5`, clamped to [-1.0, 1.0].
/// - When only one source has data and exceeds a drain threshold (~100ms at
///   48kHz = 4800 samples), drains the single-source buffer to prevent
///   unbounded accumulation (handles cases like no mic permission).
/// - Sanitizes NaN/Infinity values to 0.0 before mixing.
final class AudioMixer: @unchecked Sendable {
    /// Number of samples before a single-source buffer is drained.
    /// At 48kHz mono, 4800 samples ≈ 100ms.
    static let drainThreshold = 4800

    private var systemBuffer: [Float] = []
    private var micBuffer: [Float] = []
    private let lock = NSLock()

    /// Append sanitized system audio samples.
    func pushSystemAudio(_ samples: [Float]) {
        let sanitized = Self.sanitize(samples)
        lock.withLock {
            systemBuffer.append(contentsOf: sanitized)
        }
    }

    /// Append sanitized microphone samples.
    func pushMicrophone(_ samples: [Float]) {
        let sanitized = Self.sanitize(samples)
        lock.withLock {
            micBuffer.append(contentsOf: sanitized)
        }
    }

    /// Drain mixed output. Returns an array of mixed Float samples.
    ///
    /// - When both buffers have data: mix overlapping portion, leave remainder.
    /// - When only one buffer exceeds drain threshold: drain it as-is.
    /// - Otherwise: returns empty (waiting for more data).
    func drain() -> [Float] {
        lock.withLock {
            drainLocked()
        }
    }

    /// Flush all remaining samples. Call when recording stops.
    func flush() -> [Float] {
        lock.withLock {
            flushLocked()
        }
    }

    /// Reset both buffers.
    func reset() {
        lock.withLock {
            systemBuffer.removeAll()
            micBuffer.removeAll()
        }
    }

    // MARK: - Internal (lock must be held)

    private func drainLocked() -> [Float] {
        let sysCount = systemBuffer.count
        let micCount = micBuffer.count

        // Both have data: mix the overlapping portion
        if sysCount > 0 && micCount > 0 {
            let mixCount = min(sysCount, micCount)
            var output = [Float](repeating: 0, count: mixCount)
            for i in 0..<mixCount {
                let mixed = (systemBuffer[i] + micBuffer[i]) * 0.5
                output[i] = max(-1.0, min(1.0, mixed))
            }
            systemBuffer.removeFirst(mixCount)
            micBuffer.removeFirst(mixCount)
            return output
        }

        // Only system audio, above threshold: drain
        if sysCount >= Self.drainThreshold && micCount == 0 {
            let output = Array(systemBuffer)
            systemBuffer.removeAll()
            return output
        }

        // Only mic, above threshold: drain
        if micCount >= Self.drainThreshold && sysCount == 0 {
            let output = Array(micBuffer)
            micBuffer.removeAll()
            return output
        }

        // Not enough data yet
        return []
    }

    private func flushLocked() -> [Float] {
        let sysCount = systemBuffer.count
        let micCount = micBuffer.count

        if sysCount > 0 && micCount > 0 {
            // Mix overlapping, then append remainder
            let mixCount = min(sysCount, micCount)
            var output = [Float](repeating: 0, count: max(sysCount, micCount))
            for i in 0..<mixCount {
                let mixed = (systemBuffer[i] + micBuffer[i]) * 0.5
                output[i] = max(-1.0, min(1.0, mixed))
            }
            // Append remaining from whichever is longer
            if sysCount > micCount {
                for i in mixCount..<sysCount {
                    output[i] = systemBuffer[i]
                }
            } else if micCount > sysCount {
                for i in mixCount..<micCount {
                    output[i] = micBuffer[i]
                }
            }
            systemBuffer.removeAll()
            micBuffer.removeAll()
            return output
        }

        if sysCount > 0 {
            let output = Array(systemBuffer)
            systemBuffer.removeAll()
            return output
        }

        if micCount > 0 {
            let output = Array(micBuffer)
            micBuffer.removeAll()
            return output
        }

        return []
    }

    // MARK: - Sanitization

    /// Replace NaN/Infinity with 0.0 and clamp to [-1.0, 1.0].
    static func sanitize(_ samples: [Float]) -> [Float] {
        samples.map { sample in
            guard sample.isFinite else { return Float(0.0) }
            return max(-1.0, min(1.0, sample))
        }
    }
}
