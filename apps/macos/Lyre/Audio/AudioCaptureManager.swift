import AVFoundation
import CoreAudio
import os
import ScreenCaptureKit

/// A microphone input device available for recording.
struct AudioInputDevice: Identifiable, Equatable, Sendable {
    let id: String       // AVCaptureDevice.uniqueID
    let name: String     // AVCaptureDevice.localizedName
}

/// Manages ScreenCaptureKit audio capture for both system audio and microphone.
/// System audio (.audio) + microphone (.microphone) → AudioMixer → mixed PCM output.
@Observable
final class AudioCaptureManager: NSObject, @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "AudioCaptureManager")

    /// Callback invoked with mixed PCM samples ready for encoding.
    var onMixedSamples: (([Float]) -> Void)?

    /// Callback invoked when the stream stops unexpectedly.
    var onStreamError: ((Error) -> Void)?

    /// Available microphone input devices.
    internal(set) var availableDevices: [AudioInputDevice] = []

    /// Currently selected microphone device ID. Nil = system default.
    var selectedDeviceID: String?

    private var stream: SCStream?
    private let mixer = AudioMixer()
    private let sampleRate: Int = Constants.Audio.sampleRateInt
    private let channelCount: Int = Constants.Audio.channelCountInt

    /// Counters for debugging audio delivery.
    private var systemAudioBufferCount: Int = 0
    private var micBufferCount: Int = 0

    /// Timer that periodically drains the mixer and delivers mixed samples.
    private var drainTimer: Timer?

    /// Whether CoreAudio device-change listener is installed.
    private var isListeningForDeviceChanges = false

    // MARK: - Device Enumeration

    /// Refresh the list of available microphone input devices using AVFoundation.
    func refreshDevices() {
        enumerateDevices()
        installDeviceChangeListener()
    }

    /// Install a CoreAudio property listener that auto-refreshes the device list
    /// whenever audio devices are connected or disconnected.
    private func installDeviceChangeListener() {
        guard !isListeningForDeviceChanges else { return }
        isListeningForDeviceChanges = true

        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        let status = AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            DispatchQueue.main
        ) { [weak self] _, _ in
            Self.logger.debug("Audio device list changed, refreshing")
            self?.enumerateDevices()
        }

        if status != noErr {
            Self.logger.warning("Failed to install audio device change listener: \(status)")
            isListeningForDeviceChanges = false
        }
    }

    /// Enumerate audio input devices and update the list. Falls back to system default
    /// if the currently selected device is no longer available.
    private func enumerateDevices() {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInMicrophone, .external],
            mediaType: .audio,
            position: .unspecified
        )
        let newDevices = discovery.devices.map { device in
            AudioInputDevice(id: device.uniqueID, name: device.localizedName)
        }

        guard newDevices != availableDevices else { return }
        availableDevices = newDevices
        Self.logger.info("Device list updated: \(newDevices.map(\.name).joined(separator: ", "))")

        // If the selected device was unplugged, fall back to system default
        if let selected = selectedDeviceID,
           !newDevices.contains(where: { $0.id == selected }) {
            Self.logger.info("Selected device \(selected) disconnected, falling back to default")
            selectedDeviceID = nil
        }
    }

    // MARK: - Capture Control

    /// Start capturing system audio and microphone.
    func startCapture() async throws {
        let content = try await SCShareableContent.current

        // Display required for content filter, even for audio-only capture.
        guard let display = content.displays.first else {
            throw CaptureError.noDisplayFound
        }

        let filter = SCContentFilter(
            display: display,
            excludingApplications: [],
            exceptingWindows: []
        )

        let config = SCStreamConfiguration()
        config.width = 2  // Minimal video (required by SCStream, unused)
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 FPS

        // System audio
        config.capturesAudio = true
        config.sampleRate = sampleRate
        config.channelCount = channelCount

        // Microphone
        config.captureMicrophone = true
        if let deviceID = selectedDeviceID {
            config.microphoneCaptureDeviceID = deviceID
        }

        mixer.reset()
        systemAudioBufferCount = 0
        micBufferCount = 0

        let newStream = SCStream(filter: filter, configuration: config, delegate: self)

        // Register separate output handlers for system audio and microphone
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))
        try newStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: .global(qos: .userInitiated))

        let deviceLabel = selectedDeviceID ?? "default"
        Self.logger.info("Starting capture: mic=\(config.captureMicrophone), device=\(deviceLabel)")

        try await newStream.startCapture()
        stream = newStream

        // Start drain timer on main thread (~20ms interval for low latency)
        await MainActor.run {
            drainTimer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in
                self?.drainMixer()
            }
        }
    }

    /// Stop capturing.
    func stopCapture() async throws {
        await MainActor.run {
            drainTimer?.invalidate()
            drainTimer = nil
        }

        Self.logger.info("Stopping capture: systemAudio=\(self.systemAudioBufferCount) buffers, mic=\(self.micBufferCount) buffers")

        if let stream {
            try await stream.stopCapture()
        }
        stream = nil

        // Flush remaining samples
        let remaining = mixer.flush()
        if !remaining.isEmpty {
            onMixedSamples?(remaining)
        }
    }

    // MARK: - Private

    private func drainMixer() {
        let samples = mixer.drain()
        if !samples.isEmpty {
            onMixedSamples?(samples)
        }
    }

    /// Extract Float32 mono PCM samples from a CMSampleBuffer.
    /// Handles Float32/Int16, mono/stereo. Stereo→mono uses "louder channel" strategy
    /// (picks channel with larger absolute value per frame, avoids -6dB loss from averaging).
    static func extractSamples(from sampleBuffer: CMSampleBuffer) -> [Float]? {
        guard let rawData = getRawAudioData(from: sampleBuffer) else { return nil }

        if rawData.bitsPerChannel == 32 {
            return extractFloat32Samples(rawData)
        } else if rawData.bitsPerChannel == 16 {
            return extractInt16Samples(rawData)
        } else {
            logger.warning("Unsupported audio format: \(rawData.bitsPerChannel) bits/channel")
            return nil
        }
    }

    /// Raw audio data extracted from a CMSampleBuffer.
    private struct RawAudioData {
        let rawPtr: UnsafeRawPointer
        let length: Int
        let channels: Int
        let bitsPerChannel: Int
    }

    /// Extract raw byte pointer and format info from a CMSampleBuffer.
    private static func getRawAudioData(from sampleBuffer: CMSampleBuffer) -> RawAudioData? {
        guard let blockBuffer = sampleBuffer.dataBuffer else { return nil }
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
            return nil
        }

        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer, atOffset: 0,
            lengthAtOffsetOut: nil, totalLengthOut: &length,
            dataPointerOut: &dataPointer
        )
        guard status == kCMBlockBufferNoErr, let data = dataPointer, length > 0 else {
            return nil
        }

        let desc = asbd.pointee
        return RawAudioData(
            rawPtr: UnsafeRawPointer(data),
            length: length,
            channels: Int(desc.mChannelsPerFrame),
            bitsPerChannel: Int(desc.mBitsPerChannel)
        )
    }

    /// Extract Float32 samples, downmixing to mono if multi-channel.
    private static func extractFloat32Samples(_ data: RawAudioData) -> [Float]? {
        let totalFloats = data.length / MemoryLayout<Float>.size
        guard totalFloats > 0 else { return nil }
        let floatPtr = data.rawPtr.bindMemory(to: Float.self, capacity: totalFloats)
        let floats = UnsafeBufferPointer(start: floatPtr, count: totalFloats)

        guard data.channels > 1 else { return Array(floats) }

        let frameCount = totalFloats / data.channels
        var mono = [Float](repeating: 0, count: frameCount)
        for frame in 0..<frameCount {
            mono[frame] = pickLouderChannel(floats, frame: frame, channels: data.channels)
        }
        return mono
    }

    /// Extract Int16 samples as Float32, downmixing to mono if multi-channel.
    private static func extractInt16Samples(_ data: RawAudioData) -> [Float]? {
        let totalInt16s = data.length / MemoryLayout<Int16>.size
        guard totalInt16s > 0 else { return nil }
        let int16Ptr = data.rawPtr.bindMemory(to: Int16.self, capacity: totalInt16s)
        let int16s = UnsafeBufferPointer(start: int16Ptr, count: totalInt16s)
        let scale: Float = 1.0 / 32768.0

        guard data.channels > 1 else {
            return int16s.map { Float($0) * scale }
        }

        let frameCount = totalInt16s / data.channels
        var mono = [Float](repeating: 0, count: frameCount)
        for frame in 0..<frameCount {
            mono[frame] = pickLouderInt16Channel(int16s, frame: frame, channels: data.channels, scale: scale)
        }
        return mono
    }

    /// Pick the channel with the largest absolute value for a given Float32 frame.
    private static func pickLouderChannel(
        _ buffer: UnsafeBufferPointer<Float>,
        frame: Int,
        channels: Int
    ) -> Float {
        var best: Float = 0
        var bestAbs: Float = 0
        for ch in 0..<channels {
            let val = buffer[frame * channels + ch]
            let absVal = abs(val)
            if absVal > bestAbs {
                best = val
                bestAbs = absVal
            }
        }
        return best
    }

    /// Pick the channel with the largest absolute value for a given Int16 frame.
    private static func pickLouderInt16Channel(
        _ buffer: UnsafeBufferPointer<Int16>,
        frame: Int,
        channels: Int,
        scale: Float
    ) -> Float {
        var best: Float = 0
        var bestAbs: Float = 0
        for ch in 0..<channels {
            let val = Float(buffer[frame * channels + ch]) * scale
            let absVal = abs(val)
            if absVal > bestAbs {
                best = val
                bestAbs = absVal
            }
        }
        return best
    }

    // MARK: - Errors

    enum CaptureError: LocalizedError {
        case noDisplayFound

        var errorDescription: String? {
            switch self {
            case .noDisplayFound:
                return "No display found for ScreenCaptureKit content filter"
            }
        }
    }
}

// MARK: - SCStreamOutput

extension AudioCaptureManager: SCStreamOutput {
    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard sampleBuffer.isValid else { return }
        guard outputType == .audio || outputType == .microphone else { return }

        trackBufferCount(outputType, sampleBuffer: sampleBuffer)

        guard let samples = Self.extractSamples(from: sampleBuffer) else { return }

        logAmplitudeIfNeeded(outputType, samples: samples)

        if outputType == .audio {
            mixer.pushSystemAudio(samples)
        } else {
            mixer.pushMicrophone(samples)
        }
    }

    /// Increment buffer count and log format details on first buffer of each type.
    private func trackBufferCount(_ type: SCStreamOutputType, sampleBuffer: CMSampleBuffer) {
        if type == .audio {
            systemAudioBufferCount += 1
            if systemAudioBufferCount == 1 { logBufferFormat(sampleBuffer, label: "SystemAudio") }
        } else {
            micBufferCount += 1
            if micBufferCount == 1 { logBufferFormat(sampleBuffer, label: "Microphone") }
        }
    }

    /// Log peak amplitude every ~1 second (48000/1024 ≈ 47 buffers).
    private func logAmplitudeIfNeeded(_ type: SCStreamOutputType, samples: [Float]) {
        let count = type == .audio ? systemAudioBufferCount : micBufferCount
        guard count % 47 == 1 else { return }
        let peak = samples.reduce(Float(0)) { max($0, abs($1)) }
        let label = type == .audio ? "SystemAudio" : "Microphone"
        Self.logger.debug("\(label) peak=\(String(format: "%.4f", peak)) samples=\(samples.count)")
    }

    private func logBufferFormat(_ sampleBuffer: CMSampleBuffer, label: String) {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            Self.logger.info("\(label): no format description")
            return
        }
        if let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) {
            let desc = asbd.pointee
            Self.logger.info("""
                \(label) format: rate=\(desc.mSampleRate) ch=\(desc.mChannelsPerFrame) \
                bits=\(desc.mBitsPerChannel) bytesPerFrame=\(desc.mBytesPerFrame) \
                framesPerPacket=\(desc.mFramesPerPacket) format=\(desc.mFormatID)
                """)
        }
    }
}

// MARK: - SCStreamDelegate

extension AudioCaptureManager: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        Self.logger.error("Stream stopped with error: \(error.localizedDescription)")
        onStreamError?(error)
    }
}
