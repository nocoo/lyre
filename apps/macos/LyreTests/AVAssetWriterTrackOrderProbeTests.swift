import AVFoundation
import Accelerate
import Testing
@testable import Lyre

/// Phase 0A probe for the "add() order == tracks() order" assumption that
/// the sidecar mapping in `docs/06-macos-audio-pipeline-redesign.md` relies
/// on.
///
/// Two AAC `AVAssetWriterInput`s with identical `outputSettings` are
/// `add()`'d in a fixed order (system first, mic second). We then write
/// distinguishable content to each (different sine frequencies) and read
/// the resulting `.m4a` back to FFT the leading 100 ms of each decoded
/// track. If `tracks[0]` always carries the system frequency and `tracks[1]`
/// always carries the mic frequency across N iterations, the sidecar can
/// safely map `roleByTrackIndex` to (system, mic) based on `add()` order.
///
/// `trackID` and ASBD comparison are deliberately NOT used: identical
/// `outputSettings` produce identical ASBDs, and `trackID` is assigned
/// internally by AVAssetWriter with no ordering guarantee.
@Suite("Phase 0A: AVAssetWriter track-order probe")
struct AVAssetWriterTrackOrderProbeTests {
    private static let sampleRate: Double = 48_000
    private static let timescale: CMTimeScale = CMTimeScale(sampleRate)
    private static let iterations = 20
    private static let systemFrequency: Double = 440  // A4
    private static let micFrequency: Double = 880    // A5

    @Test func addOrderEqualsTracksOrder() throws {
        var verdicts: [(systemHz: Double, micHz: Double)] = []
        verdicts.reserveCapacity(Self.iterations)

        for iteration in 0..<Self.iterations {
            let url = Self.makeTemporaryURL(iteration: iteration)
            defer { try? FileManager.default.removeItem(at: url) }

            let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)

            // Both inputs share the same outputSettings — ASBD and
            // bitrate are identical. Differentiation comes from the
            // sample content (frequency) only.
            let sysInput = try Self.makeAACInput()
            let micInput = try Self.makeAACInput()
            // expectsMediaDataInRealTime must be set BEFORE add / startWriting.
            sysInput.expectsMediaDataInRealTime = false
            micInput.expectsMediaDataInRealTime = false

            // Fixed add() order: system first, then mic. This is the
            // order the sidecar mapping locks in.
            writer.add(sysInput)
            writer.add(micInput)

            #expect(writer.startWriting())
            writer.startSession(atSourceTime: .zero)

            let sysBuffer = AVAssetWriterPTSProbeTests.makeSineBuffer(
                frequency: Self.systemFrequency,
                durationSeconds: 1.0,
                startPTS: .zero,
            )
            let micBuffer = AVAssetWriterPTSProbeTests.makeSineBuffer(
                frequency: Self.micFrequency,
                durationSeconds: 1.0,
                startPTS: .zero,
            )
            #expect(sysInput.append(sysBuffer))
            #expect(micInput.append(micBuffer))

            sysInput.markAsFinished()
            micInput.markAsFinished()

            let group = DispatchGroup()
            group.enter()
            writer.finishWriting { group.leave() }
            group.wait()
            #expect(writer.status == .completed, "iter \(iteration) writer failed: \(String(describing: writer.error))")

            let (track0Hz, track1Hz) = try Self.readTrackDominantFrequencies(from: url)
            verdicts.append((systemHz: track0Hz, micHz: track1Hz))
        }

        // Hard assertion: every iteration must show tracks[0] ≈ 440 Hz and
        // tracks[1] ≈ 880 Hz. Tolerance of ±20 Hz absorbs FFT bin width at
        // 100 ms / 48 kHz (~10 Hz resolution).
        for (i, v) in verdicts.enumerated() {
            #expect(
                abs(v.systemHz - Self.systemFrequency) <= 20,
                "iter \(i): tracks[0] dominant freq = \(v.systemHz) Hz, expected ~\(Self.systemFrequency) Hz (system)",
            )
            #expect(
                abs(v.micHz - Self.micFrequency) <= 20,
                "iter \(i): tracks[1] dominant freq = \(v.micHz) Hz, expected ~\(Self.micFrequency) Hz (mic)",
            )
        }
    }

    // MARK: - Helpers

    private static func makeTemporaryURL(iteration: Int) -> URL {
        let dir = FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("track-order-probe-\(iteration)-\(UUID().uuidString).m4a")
    }

    private static func makeAACInput() throws -> AVAssetWriterInput {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128_000,
        ]
        return AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
    }

    static func readTrackDominantFrequencies(from url: URL) throws -> (Double, Double) {
        let asset = AVURLAsset(url: url)
        return try AVAssetWriterPTSProbeTests.awaitable { () throws -> (Double, Double) in
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            guard tracks.count >= 2 else { throw ProbeError.expectedTwoTracks(found: tracks.count) }
            let hz0 = try dominantFrequency(of: tracks[0], asset: asset)
            let hz1 = try dominantFrequency(of: tracks[1], asset: asset)
            return (hz0, hz1)
        }
    }

    private static func dominantFrequency(of track: AVAssetTrack, asset: AVAsset) throws -> Double {
        let reader = try AVAssetReader(asset: asset)
        // Force linear PCM Float32 mono — easy FFT input regardless of
        // the AAC encoder's internal layout.
        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
        ]
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: outputSettings)
        reader.add(output)
        reader.startReading()

        // Need ≥ 100 ms (4800 frames). Use 4096 (power of two for FFT).
        let targetFrames = 4096
        var collected = [Float](repeating: 0, count: targetFrames)
        var written = 0

        while written < targetFrames, let sample = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
            var length = 0
            var dataPointer: UnsafeMutablePointer<Int8>?
            CMBlockBufferGetDataPointer(
                block,
                atOffset: 0,
                lengthAtOffsetOut: nil,
                totalLengthOut: &length,
                dataPointerOut: &dataPointer,
            )
            guard let dataPointer else { continue }

            let framesInBuffer = length / MemoryLayout<Float>.size
            let take = min(framesInBuffer, targetFrames - written)
            dataPointer.withMemoryRebound(to: Float.self, capacity: framesInBuffer) { floatPtr in
                for i in 0..<take {
                    collected[written + i] = floatPtr[i]
                }
            }
            written += take
        }

        return fftDominantFrequency(samples: collected)
    }

    /// Compute the dominant frequency in `samples` via Accelerate vDSP FFT.
    /// `samples.count` is expected to be a power of two; the caller passes
    /// 4096 so the bin width at 48 kHz is ~11.7 Hz — well within the ±20 Hz
    /// tolerance on the assertion.
    private static func fftDominantFrequency(samples: [Float]) -> Double {
        let n = samples.count
        let log2n = vDSP_Length(log2(Double(n)))
        guard let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
            return 0
        }
        defer { vDSP_destroy_fftsetup(setup) }

        var real = [Float](repeating: 0, count: n / 2)
        var imag = [Float](repeating: 0, count: n / 2)

        return real.withUnsafeMutableBufferPointer { realPtr in
            imag.withUnsafeMutableBufferPointer { imagPtr in
                var split = DSPSplitComplex(realp: realPtr.baseAddress!, imagp: imagPtr.baseAddress!)

                samples.withUnsafeBufferPointer { samplesPtr in
                    samplesPtr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n / 2) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(n / 2))
                    }
                }

                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))

                var magnitudes = [Float](repeating: 0, count: n / 2)
                vDSP_zvmags(&split, 1, &magnitudes, 1, vDSP_Length(n / 2))

                // Skip DC bin (index 0). vDSP_maxvi finds the index of
                // the maximum magnitude in a single pass and side-steps
                // the for/if-where lint rule.
                var maxValue: Float = 0
                var maxIndexUInt: vDSP_Length = 0
                magnitudes.withUnsafeBufferPointer { mPtr in
                    let start = mPtr.baseAddress!.advanced(by: 1)
                    vDSP_maxvi(start, 1, &maxValue, &maxIndexUInt, vDSP_Length((n / 2) - 1))
                }
                let maxIndex = maxIndexUInt + 1  // compensate for the +1 offset
                let binWidth = sampleRate / Double(n)
                return Double(maxIndex) * binWidth
            }
        }
    }

    enum ProbeError: Error { case expectedTwoTracks(found: Int) }
}
