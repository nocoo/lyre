import AVFoundation
import Foundation
import os

/// Downmix a multi-track M4A into a single-track M4A suitable for HTML5 <audio>.
///
/// Why this exists:
/// - RecordingManager encodes with mode `.dualTrack`, writing system audio
///   and mic on two separate `AVAssetWriterInput`s. That's ideal for
///   server-side ASR that wants to distinguish speakers, but browsers only
///   play the first audio track, so a dual-track M4A sounds silent in the
///   dashboard even though the file is well-formed and locally playable.
/// - Rather than change the encoding strategy, we downmix at upload time:
///   read both PCM streams, average them per sample, re-encode as a single
///   AAC track. Output stays audio/mp4 with faststart, so the dashboard
///   player sees one audible track and just works.
enum AudioDownmixer {
    private static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "AudioDownmixer"
    )

    enum DownmixError: LocalizedError {
        case cannotReadAsset(String)
        case noAudioTracks
        case readerSetupFailed(String)
        case writerSetupFailed(String)
        case encodeFailed(String)

        var errorDescription: String? {
            switch self {
            case .cannotReadAsset(let d): return "Cannot read source asset: \(d)"
            case .noAudioTracks:          return "Source has no audio tracks"
            case .readerSetupFailed(let d): return "AVAssetReader setup failed: \(d)"
            case .writerSetupFailed(let d): return "AVAssetWriter setup failed: \(d)"
            case .encodeFailed(let d):    return "Downmix encode failed: \(d)"
            }
        }
    }

    /// Downmix `source` into a single-track M4A at `destination`.
    ///
    /// If the source already has ≤ 1 audio track, copies it via
    /// `FileManager.copyItem` unchanged (avoids a lossy re-encode).
    /// Otherwise decodes every track to Float32 PCM at a common sample
    /// rate, averages them, and re-encodes as one mono AAC track.
    static func downmix(source: URL, destination: URL) async throws {
        let asset = AVURLAsset(url: source)

        let tracks: [AVAssetTrack]
        do {
            tracks = try await asset.loadTracks(withMediaType: .audio)
        } catch {
            throw DownmixError.cannotReadAsset(error.localizedDescription)
        }

        guard !tracks.isEmpty else {
            throw DownmixError.noAudioTracks
        }

        // Single-track fast path: no re-encode.
        if tracks.count == 1 {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.copyItem(at: source, to: destination)
            logger.info("Single-track source — copied without re-encode")
            return
        }

        logger.info("Downmixing \(tracks.count) tracks: \(source.lastPathComponent)")

        let sampleRate = Constants.Audio.sampleRate
        try await runDownmix(
            asset: asset,
            tracks: tracks,
            destination: destination,
            sampleRate: sampleRate
        )
    }

    // MARK: - Core

    private static func runDownmix(
        asset: AVAsset,
        tracks: [AVAssetTrack],
        destination: URL,
        sampleRate: Double
    ) async throws {
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }

        let (reader, outputs) = try makeReader(asset: asset, tracks: tracks, sampleRate: sampleRate)
        let (writer, input) = try makeWriter(destination: destination, sampleRate: sampleRate)

        guard reader.startReading() else {
            throw DownmixError.readerSetupFailed(
                reader.error?.localizedDescription ?? "unknown"
            )
        }
        guard writer.startWriting() else {
            throw DownmixError.writerSetupFailed(
                writer.error?.localizedDescription ?? "unknown"
            )
        }
        writer.startSession(atSourceTime: .zero)

        try await pumpMixedSamples(
            outputs: outputs,
            input: input,
            writer: writer,
            sampleRate: sampleRate
        )

        input.markAsFinished()
        await writer.finishWriting()

        if writer.status != .completed {
            let msg = writer.error?.localizedDescription ?? "status=\(writer.status.rawValue)"
            throw DownmixError.encodeFailed(msg)
        }
        if reader.status == .failed {
            let msg = reader.error?.localizedDescription ?? "reader failed"
            throw DownmixError.encodeFailed(msg)
        }

        logger.info("Downmix complete → \(destination.lastPathComponent)")
    }

    /// Configure an AVAssetReader that emits Float32 mono PCM at the
    /// target sample rate for every input track. The reader handles
    /// resampling and channel down-conversion — the caller just averages.
    private static func makeReader(
        asset: AVAsset,
        tracks: [AVAssetTrack],
        sampleRate: Double
    ) throws -> (AVAssetReader, [AVAssetReaderTrackOutput]) {
        let pcmSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]

        let reader: AVAssetReader
        do {
            reader = try AVAssetReader(asset: asset)
        } catch {
            throw DownmixError.readerSetupFailed(error.localizedDescription)
        }

        var outputs: [AVAssetReaderTrackOutput] = []
        for track in tracks {
            let out = AVAssetReaderTrackOutput(track: track, outputSettings: pcmSettings)
            out.alwaysCopiesSampleData = false
            guard reader.canAdd(out) else {
                throw DownmixError.readerSetupFailed("cannot add track output")
            }
            reader.add(out)
            outputs.append(out)
        }
        return (reader, outputs)
    }

    /// Configure an AVAssetWriter with a single AAC track (mono, target
    /// sample rate) and faststart enabled so the resulting M4A is ready
    /// for HTTP streaming to <audio>.
    private static func makeWriter(
        destination: URL,
        sampleRate: Double
    ) throws -> (AVAssetWriter, AVAssetWriterInput) {
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: destination, fileType: .m4a)
        } catch {
            throw DownmixError.writerSetupFailed(error.localizedDescription)
        }
        writer.shouldOptimizeForNetworkUse = true

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: Constants.Audio.aacBitRate,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: outputSettings)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else {
            throw DownmixError.writerSetupFailed("cannot add AAC input")
        }
        writer.add(input)
        return (writer, input)
    }

    // MARK: - Sample pump

    /// Read one PCM buffer from every track output, average the samples
    /// element-wise, and append the mixed buffer to the writer input.
    ///
    /// Blocks on `input.isReadyForMoreMediaData` between appends. Ends
    /// when every reader output returns nil.
    private static func pumpMixedSamples(
        outputs: [AVAssetReaderTrackOutput],
        input: AVAssetWriterInput,
        writer: AVAssetWriter,
        sampleRate: Double
    ) async throws {
        var done: [Bool] = Array(repeating: false, count: outputs.count)

        while !done.allSatisfy({ $0 }) {
            while !input.isReadyForMoreMediaData {
                try await Task.sleep(nanoseconds: 5_000_000) // 5 ms
            }

            let batch = readOneBatch(outputs: outputs, done: &done)
            guard !batch.floats.isEmpty, batch.frameCount > 0 else { continue }

            let mixed = averageBatch(floats: batch.floats, frameCount: batch.frameCount)

            guard let outBuffer = makeSampleBuffer(
                floats: mixed,
                pts: batch.pts,
                sampleRate: sampleRate
            ) else {
                throw DownmixError.encodeFailed("failed to build output sample buffer")
            }

            if !input.append(outBuffer) {
                let msg = writer.error?.localizedDescription ?? "append rejected"
                throw DownmixError.encodeFailed(msg)
            }
        }
    }

    private struct SampleBatch {
        let floats: [[Float]]
        let frameCount: Int
        let pts: CMTime
    }

    /// One "round" of the pump: pull the next PCM buffer from every
    /// still-active track output. Marks outputs as done when they return
    /// nil so the main loop can terminate cleanly. Returns the earliest
    /// PTS of the batch (for dual-track output from AudioEncoder these
    /// are already time-aligned to `startSession(atSourceTime: .zero)`).
    private static func readOneBatch(
        outputs: [AVAssetReaderTrackOutput],
        done: inout [Bool]
    ) -> SampleBatch {
        var perTrackFloats: [[Float]] = []
        var perTrackPTS: [CMTime] = []
        var frameCount = Int.max

        for (idx, output) in outputs.enumerated() {
            if done[idx] { continue }
            guard let sb = output.copyNextSampleBuffer() else {
                done[idx] = true
                continue
            }
            guard let (floats, pts) = extractMonoFloats(from: sb) else { continue }
            perTrackFloats.append(floats)
            perTrackPTS.append(pts)
            frameCount = min(frameCount, floats.count)
        }

        let pts = perTrackPTS.min(by: { $0.value < $1.value }) ?? .zero
        return SampleBatch(
            floats: perTrackFloats,
            frameCount: frameCount == Int.max ? 0 : frameCount,
            pts: pts
        )
    }

    /// Element-wise average of per-track PCM samples, truncated to the
    /// shortest track's frame count.
    private static func averageBatch(floats: [[Float]], frameCount: Int) -> [Float] {
        var mixed = [Float](repeating: 0, count: frameCount)
        let n = Float(floats.count)
        for arr in floats {
            for i in 0..<frameCount {
                mixed[i] += arr[i]
            }
        }
        for i in 0..<frameCount {
            mixed[i] /= n
        }
        return mixed
    }

    // MARK: - CMSampleBuffer helpers

    // Split out into AudioDownmixerHelpers.swift to keep the top-level
    // downmix flow (setup → pump → finalize) inside a single readable
    // type body — the CMSampleBuffer plumbing is unrelated to the pump
    // logic and gets its own file.
}
