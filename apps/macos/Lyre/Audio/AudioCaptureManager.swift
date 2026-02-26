import AVFoundation
import ScreenCaptureKit

/// A microphone input device available for recording.
struct AudioInputDevice: Identifiable, Equatable, Sendable {
    let id: String       // AVCaptureDevice.uniqueID
    let name: String     // AVCaptureDevice.localizedName
}

/// Manages ScreenCaptureKit audio capture for both system audio and microphone.
///
/// This is the core audio pipeline for meeting recording:
/// - System audio (.audio) captures other participants' voices from speaker output
/// - Microphone (.microphone) captures the local user's voice
///
/// Samples from both streams are fed into an `AudioMixer` for combination.
final class AudioCaptureManager: NSObject, @unchecked Sendable {
    /// Callback invoked with mixed PCM samples ready for encoding.
    var onMixedSamples: (([Float]) -> Void)?

    /// Callback invoked when the stream stops unexpectedly.
    var onStreamError: ((Error) -> Void)?

    /// Available microphone input devices.
    private(set) var availableDevices: [AudioInputDevice] = []

    /// Currently selected microphone device ID. Nil = system default.
    var selectedDeviceID: String?

    private var stream: SCStream?
    private let mixer = AudioMixer()
    private let sampleRate: Int = 48000
    private let channelCount: Int = 1

    /// Timer that periodically drains the mixer and delivers mixed samples.
    private var drainTimer: Timer?

    // MARK: - Device Enumeration

    /// Refresh the list of available microphone input devices using AVFoundation.
    func refreshDevices() {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInMicrophone, .external],
            mediaType: .audio,
            position: .unspecified
        )
        availableDevices = discovery.devices.map { device in
            AudioInputDevice(id: device.uniqueID, name: device.localizedName)
        }
    }

    // MARK: - Capture Control

    /// Start capturing system audio and microphone.
    ///
    /// - Throws: If ScreenCaptureKit fails to initialize or start.
    func startCapture() async throws {
        let content = try await SCShareableContent.current

        // We need a display to create a content filter (required even for audio-only).
        // Use a minimal video config to avoid wasting resources.
        guard let display = content.displays.first else {
            throw CaptureError.noDisplayFound
        }

        let filter = SCContentFilter(
            display: display,
            excludingApplications: [],
            exceptingWindows: []
        )

        let config = SCStreamConfiguration()
        // Minimal video (required by SCStream but we don't use it)
        config.width = 2
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

        let newStream = SCStream(filter: filter, configuration: config, delegate: self)

        // Register separate output handlers for system audio and microphone
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))
        try newStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: .global(qos: .userInitiated))

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

    /// Extract Float32 PCM samples from a CMSampleBuffer.
    static func extractSamples(from sampleBuffer: CMSampleBuffer) -> [Float]? {
        guard let blockBuffer = sampleBuffer.dataBuffer else { return nil }

        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer,
            atOffset: 0,
            lengthAtOffsetOut: nil,
            totalLengthOut: &length,
            dataPointerOut: &dataPointer
        )
        guard status == kCMBlockBufferNoErr, let data = dataPointer else { return nil }

        let floatCount = length / MemoryLayout<Float>.size
        guard floatCount > 0 else { return nil }

        let floatPointer = UnsafeRawPointer(data).bindMemory(to: Float.self, capacity: floatCount)
        return Array(UnsafeBufferPointer(start: floatPointer, count: floatCount))
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
        guard let samples = Self.extractSamples(from: sampleBuffer) else { return }

        switch outputType {
        case .audio:
            mixer.pushSystemAudio(samples)
        case .microphone:
            mixer.pushMicrophone(samples)
        default:
            break // Ignore video frames
        }
    }
}

// MARK: - SCStreamDelegate

extension AudioCaptureManager: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        print("[AudioCaptureManager] Stream stopped with error: \(error.localizedDescription)")
        onStreamError?(error)
    }
}
