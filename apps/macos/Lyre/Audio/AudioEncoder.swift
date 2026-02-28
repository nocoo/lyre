import AVFoundation
import os

/// Encodes Float32 PCM audio samples into an M4A/AAC file using AVAssetWriter.
///
/// Responsibilities:
/// - AVAssetWriter lifecycle (setup → write → finalize)
/// - CMSampleBuffer creation from raw Float32 arrays
/// - Presentation timestamp tracking
///
/// Thread safety: all mutable state is protected by a dedicated serial
/// `DispatchQueue`. `encodeSamples(_:)` can safely be called from any thread
/// (typically SCStream's background callback), while `setup()` and `finalize()`
/// are called from the main actor.
final class AudioEncoder: @unchecked Sendable {
    private static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "AudioEncoder"
    )

    enum EncoderError: LocalizedError, Equatable {
        case setupFailed(String)
        case writerFailed(String)

        var errorDescription: String? {
            switch self {
            case .setupFailed(let detail):
                return "Encoder setup failed: \(detail)"
            case .writerFailed(let detail):
                return "Encoder write failed: \(detail)"
            }
        }
    }

    /// Whether the encoder is actively writing.
    var isWriting: Bool {
        queue.sync { assetWriter?.status == .writing }
    }

    // MARK: - Private state (guarded by queue)

    /// Serial queue protecting all mutable encoder state.
    private let queue = DispatchQueue(label: "ai.hexly.lyre.AudioEncoder")

    private var assetWriter: AVAssetWriter?
    private var assetWriterInput: AVAssetWriterInput?
    private var inputFormat: AVAudioFormat?
    private var totalSamplesWritten: Int64 = 0

    private let sampleRate: Double
    private let channelCount: UInt32
    private let bitRate: Int

    // MARK: - Init

    init(
        sampleRate: Double = Constants.Audio.sampleRate,
        channelCount: UInt32 = Constants.Audio.channelCount,
        bitRate: Int = Constants.Audio.aacBitRate
    ) {
        self.sampleRate = sampleRate
        self.channelCount = channelCount
        self.bitRate = bitRate
    }

    // MARK: - Lifecycle

    /// Set up AVAssetWriter for M4A/AAC encoding at the given URL.
    func setup(outputURL: URL) throws {
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        } catch {
            throw EncoderError.setupFailed(error.localizedDescription)
        }

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channelCount,
            AVEncoderBitRateKey: bitRate,
        ]

        let input = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: outputSettings
        )
        input.expectsMediaDataInRealTime = true

        guard writer.canAdd(input) else {
            throw EncoderError.setupFailed("AVAssetWriter cannot add audio input")
        }
        writer.add(input)

        guard writer.startWriting() else {
            let detail = writer.error?.localizedDescription ?? "unknown error"
            throw EncoderError.setupFailed(detail)
        }
        writer.startSession(atSourceTime: .zero)

        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: channelCount,
            interleaved: false
        )

        queue.sync {
            totalSamplesWritten = 0
            assetWriter = writer
            assetWriterInput = input
            inputFormat = format
        }
    }

    /// Encode Float32 PCM samples into the AVAssetWriter pipeline.
    ///
    /// Thread-safe: dispatches synchronously on the encoder queue.
    ///
    /// - Returns: `true` if samples were appended, `false` if skipped or failed.
    @discardableResult
    func encodeSamples(_ samples: [Float]) -> Bool {
        queue.sync {
            encodeSamplesLocked(samples)
        }
    }

    /// Finalize the AVAssetWriter and close the file.
    ///
    /// Thread-safe: acquires the encoder queue to mark finished, then awaits
    /// the asynchronous `finishWriting` completion outside the queue.
    func finalize() async {
        // Snapshot writer and mark input as finished under lock
        let writer: AVAssetWriter? = queue.sync {
            let w = assetWriter
            assetWriterInput?.markAsFinished()
            return w
        }

        guard let writer else { return }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting {
                continuation.resume()
            }
        }

        if writer.status == .failed {
            let detail = writer.error?.localizedDescription ?? "unknown"
            Self.logger.error("Writer finalization failed: \(detail)")
        }

        // Clear state under lock
        queue.sync {
            assetWriter = nil
            assetWriterInput = nil
            inputFormat = nil
        }
    }

    // MARK: - Internal (queue must be held)

    private func encodeSamplesLocked(_ samples: [Float]) -> Bool {
        guard let input = assetWriterInput,
              let writer = assetWriter,
              writer.status == .writing else {
            return false
        }

        guard input.isReadyForMoreMediaData else {
            Self.logger.warning("Writer input not ready, dropping \(samples.count) samples")
            return false
        }

        guard let sampleBuffer = createSampleBufferLocked(from: samples) else {
            Self.logger.warning("Failed to create sample buffer from \(samples.count) samples")
            return false
        }

        let appended = input.append(sampleBuffer)
        if !appended {
            let detail = writer.error?.localizedDescription ?? "unknown"
            Self.logger.error("append() failed: \(detail)")
        }
        return appended
    }

    // MARK: - Sample Buffer Creation (queue must be held)

    /// Create a CMSampleBuffer from Float32 PCM data for AVAssetWriter.
    func createSampleBuffer(from samples: [Float]) -> CMSampleBuffer? {
        queue.sync {
            createSampleBufferLocked(from: samples)
        }
    }

    private func createSampleBufferLocked(from samples: [Float]) -> CMSampleBuffer? {
        let frameCount = samples.count
        guard frameCount > 0, let format = inputFormat else { return nil }

        guard let formatDescription = format.formatDescription as CMFormatDescription? else {
            return nil
        }

        let pts = CMTime(
            value: totalSamplesWritten,
            timescale: CMTimeScale(sampleRate)
        )
        let duration = CMTime(
            value: CMTimeValue(frameCount),
            timescale: CMTimeScale(sampleRate)
        )
        totalSamplesWritten += Int64(frameCount)

        var timing = CMSampleTimingInfo(
            duration: duration,
            presentationTimeStamp: pts,
            decodeTimeStamp: .invalid
        )

        let dataSize = frameCount * MemoryLayout<Float>.size

        var blockBuffer: CMBlockBuffer?
        var status = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: dataSize,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: dataSize,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == kCMBlockBufferNoErr, let block = blockBuffer else { return nil }

        status = samples.withUnsafeBytes { rawBuf in
            CMBlockBufferReplaceDataBytes(
                with: rawBuf.baseAddress!,
                blockBuffer: block,
                offsetIntoDestination: 0,
                dataLength: dataSize
            )
        }
        guard status == kCMBlockBufferNoErr else { return nil }

        var sampleBuffer: CMSampleBuffer?
        status = CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: block,
            dataReady: true,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: formatDescription,
            sampleCount: frameCount,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 1,
            sampleSizeArray: [MemoryLayout<Float>.size],
            sampleBufferOut: &sampleBuffer
        )

        guard status == noErr else { return nil }
        return sampleBuffer
    }
}
