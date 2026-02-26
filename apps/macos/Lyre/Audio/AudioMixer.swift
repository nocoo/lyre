import Foundation
import os

/// Mixes two audio streams (system audio + microphone) into a single output.
///
/// Designed for the meeting recording use case where system audio carries
/// other participants' voices and the microphone carries the local user's voice.
///
/// Mixing strategy:
/// - Accumulates samples from each source into separate buffers.
/// - When both buffers have data, mixes overlapping samples via weighted sum
///   with configurable gain: `softClip(sys * systemGain + mic * micGain)`.
/// - When only one source has data and exceeds a drain threshold (~200ms at
///   48kHz = 9600 samples), drains the single-source buffer to prevent
///   unbounded accumulation (handles cases like no mic permission).
/// - Sanitizes NaN/Infinity values to 0.0 before mixing.
/// - Enforces a maximum buffer size (~5s at 48kHz) to prevent unbounded
///   memory growth if drain() stops being called.
final class AudioMixer: @unchecked Sendable {
    /// Number of samples before a single-source buffer is drained.
    /// At 48kHz mono, 9600 samples ≈ 200ms.
    static let drainThreshold = 9600

    /// Maximum number of samples allowed per buffer.
    /// At 48kHz mono, 240_000 samples ≈ 5 seconds.
    /// If a push would exceed this limit, the oldest samples are discarded.
    static let maxBufferSize = 240_000

    private static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "AudioMixer"
    )

    /// Gain applied to microphone samples before mixing.
    /// Raw mic input is typically much quieter than mastered system audio.
    var micGain: Float = 2.5

    /// Gain applied to system audio samples before mixing.
    var systemGain: Float = 0.8

    private var systemBuffer: [Float] = []
    private var micBuffer: [Float] = []
    private let lock = NSLock()

    /// Append sanitized system audio samples.
    func pushSystemAudio(_ samples: [Float]) {
        let sanitized = Self.sanitize(samples)
        lock.withLock {
            systemBuffer.append(contentsOf: sanitized)
            capBuffer(&systemBuffer, label: "systemAudio")
        }
    }

    /// Append sanitized microphone samples.
    func pushMicrophone(_ samples: [Float]) {
        let sanitized = Self.sanitize(samples)
        lock.withLock {
            micBuffer.append(contentsOf: sanitized)
            capBuffer(&micBuffer, label: "microphone")
        }
    }

    /// Drain mixed output. Returns an array of mixed Float samples.
    ///
    /// - When both buffers have data: mix overlapping portion, leave remainder.
    /// - When only one buffer exceeds drain threshold: drain it with gain applied.
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

    /// Enforce max buffer size by discarding oldest samples if needed.
    private func capBuffer(_ buffer: inout [Float], label: String) {
        let overflow = buffer.count - Self.maxBufferSize
        if overflow > 0 {
            buffer.removeFirst(overflow)
            Self.logger.warning(
                "\(label) buffer overflow: dropped \(overflow) oldest samples"
            )
        }
    }

    private func drainLocked() -> [Float] {
        let sysCount = systemBuffer.count
        let micCount = micBuffer.count

        // Both have data: mix the overlapping portion
        if sysCount > 0 && micCount > 0 {
            let mixCount = min(sysCount, micCount)
            var output = [Float](repeating: 0, count: mixCount)
            for i in 0..<mixCount {
                let mixed = systemBuffer[i] * systemGain + micBuffer[i] * micGain
                output[i] = Self.softClip(mixed)
            }
            systemBuffer.removeFirst(mixCount)
            micBuffer.removeFirst(mixCount)
            return output
        }

        // Only system audio, above threshold: drain with gain
        if sysCount >= Self.drainThreshold && micCount == 0 {
            let output = systemBuffer.map { Self.softClip($0 * systemGain) }
            systemBuffer.removeAll()
            return output
        }

        // Only mic, above threshold: drain with gain
        if micCount >= Self.drainThreshold && sysCount == 0 {
            let output = micBuffer.map { Self.softClip($0 * micGain) }
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
            // Mix overlapping, then append remainder with gain
            let mixCount = min(sysCount, micCount)
            var output = [Float](repeating: 0, count: max(sysCount, micCount))
            for i in 0..<mixCount {
                let mixed = systemBuffer[i] * systemGain + micBuffer[i] * micGain
                output[i] = Self.softClip(mixed)
            }
            // Append remaining from whichever is longer
            if sysCount > micCount {
                for i in mixCount..<sysCount {
                    output[i] = Self.softClip(systemBuffer[i] * systemGain)
                }
            } else if micCount > sysCount {
                for i in mixCount..<micCount {
                    output[i] = Self.softClip(micBuffer[i] * micGain)
                }
            }
            systemBuffer.removeAll()
            micBuffer.removeAll()
            return output
        }

        if sysCount > 0 {
            let output = systemBuffer.map { Self.softClip($0 * systemGain) }
            systemBuffer.removeAll()
            return output
        }

        if micCount > 0 {
            let output = micBuffer.map { Self.softClip($0 * micGain) }
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

    // MARK: - Soft Clipping

    /// Apply tanh-based soft clipping to keep output in [-1.0, 1.0] range
    /// without the harsh distortion of hard clamp.
    ///
    /// Uses `tanhf()` which naturally maps any input to (-1, 1) with a
    /// smooth saturation curve. Values within normal range (-0.7 to 0.7)
    /// pass through nearly unchanged; only peaks are gently compressed.
    static func softClip(_ sample: Float) -> Float {
        tanhf(sample)
    }
}
