import AVFoundation

/// Manages the full recording lifecycle: permissions → capture → encode → M4A file.
///
/// State machine:
/// - `.idle` → ready to record
/// - `.recording` → actively capturing and encoding audio
///
/// Uses `AudioCaptureManager` for SCK capture and `AVAssetWriter` for M4A/AAC encoding.
@Observable
final class RecordingManager: @unchecked Sendable {

    enum State: Equatable, Sendable {
        case idle
        case recording
    }

    enum RecordingError: LocalizedError, Equatable {
        case alreadyRecording
        case notRecording
        case permissionDenied
        case encoderSetupFailed(String)

        var errorDescription: String? {
            switch self {
            case .alreadyRecording:
                return "A recording is already in progress"
            case .notRecording:
                return "No recording is in progress"
            case .permissionDenied:
                return "Required permissions have not been granted"
            case .encoderSetupFailed(let detail):
                return "Failed to set up audio encoder: \(detail)"
            }
        }
    }

    // MARK: - Observable state

    internal(set) var state: State = .idle
    internal(set) var currentFileURL: URL?
    internal(set) var recordingStartTime: Date?

    /// Elapsed seconds since recording started. Updated externally by a timer or UI poll.
    var elapsedSeconds: TimeInterval {
        guard let start = recordingStartTime else { return 0 }
        return Date().timeIntervalSince(start)
    }

    /// Last error that occurred during recording.
    internal(set) var lastError: Error?

    // MARK: - Dependencies

    let permissions: PermissionManager
    let capture: AudioCaptureManager

    /// Directory where recordings are saved.
    var outputDirectory: URL

    // MARK: - Private encoder state

    private var assetWriter: AVAssetWriter?
    private var assetWriterInput: AVAssetWriterInput?
    private var inputFormat: AVAudioFormat?

    /// Sample rate and channel count — must match AudioCaptureManager.
    private let sampleRate: Double = Constants.Audio.sampleRate
    private let channelCount: UInt32 = Constants.Audio.channelCount

    // MARK: - Init

    init(
        permissions: PermissionManager = PermissionManager(),
        capture: AudioCaptureManager = AudioCaptureManager(),
        outputDirectory: URL? = nil
    ) {
        self.permissions = permissions
        self.capture = capture
        self.outputDirectory = outputDirectory ?? Self.defaultOutputDirectory()
    }

    // MARK: - Recording Control

    /// Start recording system audio + microphone to an M4A file.
    ///
    /// - Throws: `RecordingError` if already recording, permissions missing, or encoder fails.
    func startRecording() async throws {
        guard state == .idle else {
            throw RecordingError.alreadyRecording
        }

        // Verify permissions
        await permissions.checkAll()
        guard permissions.allGranted else {
            throw RecordingError.permissionDenied
        }

        lastError = nil

        // Prepare output file
        try ensureOutputDirectory()
        let fileURL = generateOutputURL()

        // Set up AVAssetWriter for M4A/AAC encoding
        totalSamplesWritten = 0
        try setupEncoder(outputURL: fileURL)

        // Wire up capture → encoder pipeline
        capture.onMixedSamples = { [weak self] samples in
            self?.encodeSamples(samples)
        }
        capture.onStreamError = { [weak self] error in
            self?.handleStreamError(error)
        }

        // Start capture
        try await capture.startCapture()

        currentFileURL = fileURL
        recordingStartTime = Date()
        state = .recording
    }

    /// Stop the current recording and finalize the M4A file.
    ///
    /// - Returns: URL of the completed M4A file.
    /// - Throws: `RecordingError` if not recording.
    @discardableResult
    func stopRecording() async throws -> URL {
        guard state == .recording else {
            throw RecordingError.notRecording
        }

        // Stop capture (flushes remaining mixer samples via onMixedSamples)
        try await capture.stopCapture()

        // Finalize encoder
        let fileURL = currentFileURL!
        await finalizeEncoder()

        // Reset state
        state = .idle
        recordingStartTime = nil
        capture.onMixedSamples = nil
        capture.onStreamError = nil

        return fileURL
    }

    // MARK: - Encoder Setup

    /// Create AVAssetWriter + input for AAC encoding.
    private func setupEncoder(outputURL: URL) throws {
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        } catch {
            throw RecordingError.encoderSetupFailed(error.localizedDescription)
        }

        // AAC output settings
        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channelCount,
            AVEncoderBitRateKey: Constants.Audio.aacBitRate,
        ]

        let input = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: outputSettings
        )
        input.expectsMediaDataInRealTime = true

        guard writer.canAdd(input) else {
            throw RecordingError.encoderSetupFailed("AVAssetWriter cannot add audio input")
        }
        writer.add(input)

        guard writer.startWriting() else {
            let detail = writer.error?.localizedDescription ?? "unknown error"
            throw RecordingError.encoderSetupFailed(detail)
        }
        writer.startSession(atSourceTime: .zero)

        // Store input format for creating sample buffers
        inputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: channelCount,
            interleaved: false
        )

        assetWriter = writer
        assetWriterInput = input
    }

    /// Encode Float32 PCM samples into the AVAssetWriter pipeline.
    private func encodeSamples(_ samples: [Float]) {
        guard let input = assetWriterInput,
              let writer = assetWriter,
              writer.status == .writing,
              input.isReadyForMoreMediaData else {
            return
        }

        guard let sampleBuffer = createSampleBuffer(from: samples) else {
            return
        }

        input.append(sampleBuffer)
    }

    /// Finalize the AVAssetWriter and close the file.
    private func finalizeEncoder() async {
        guard let writer = assetWriter else { return }

        assetWriterInput?.markAsFinished()

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting {
                continuation.resume()
            }
        }

        assetWriter = nil
        assetWriterInput = nil
        inputFormat = nil
    }

    // MARK: - Sample Buffer Creation

    /// The running sample count, used to calculate presentation timestamps.
    private var totalSamplesWritten: Int64 = 0

    /// Create a CMSampleBuffer from Float32 PCM data for AVAssetWriter.
    ///
    /// Builds the buffer directly from raw bytes without AVAudioPCMBuffer.
    func createSampleBuffer(from samples: [Float]) -> CMSampleBuffer? {
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

        // Create a block buffer with a copy of the sample data
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

        // Copy Float32 data into the block buffer
        status = samples.withUnsafeBytes { rawBuf in
            CMBlockBufferReplaceDataBytes(
                with: rawBuf.baseAddress!,
                blockBuffer: block,
                offsetIntoDestination: 0,
                dataLength: dataSize
            )
        }
        guard status == kCMBlockBufferNoErr else { return nil }

        let sampleSize = MemoryLayout<Float>.size
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
            sampleSizeArray: [sampleSize],
            sampleBufferOut: &sampleBuffer
        )

        guard status == noErr else { return nil }
        return sampleBuffer
    }

    // MARK: - Error Handling

    private func handleStreamError(_ error: Error) {
        lastError = error
        print("[RecordingManager] Stream error: \(error.localizedDescription)")

        // Attempt to stop gracefully
        Task {
            try? await stopRecording()
        }
    }

    // MARK: - File Management

    /// Default output directory: ~/Documents/Lyre Recordings/
    static func defaultOutputDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lyre Recordings", isDirectory: true)
    }

    /// Ensure the output directory exists.
    private func ensureOutputDirectory() throws {
        try FileManager.default.createDirectory(
            at: outputDirectory,
            withIntermediateDirectories: true
        )
    }

    /// Generate a timestamped output file URL.
    ///
    /// Format: `Recording 2026-02-26 at 10.30.45.m4a`
    func generateOutputURL() -> URL {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let timestamp = formatter.string(from: Date())
        let filename = "Recording \(timestamp).m4a"
        return outputDirectory.appendingPathComponent(filename)
    }
}
