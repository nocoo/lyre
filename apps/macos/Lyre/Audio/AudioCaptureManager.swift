// swiftlint:disable file_length
//
// AudioCaptureManager owns SCK setup + the SCStreamOutput dispatch
// (raw dualTrack callbacks + legacy mixer path) + PCM extraction
// helpers + CoreAudio device enumeration. Splitting these into
// multiple files would obscure the single-class lifecycle, so we
// disable the file-length cap here.
import AVFoundation
import CoreAudio
import os
import ScreenCaptureKit

/// A microphone input device available for recording.
struct AudioInputDevice: Identifiable, Equatable, Sendable {
    let id: String       // CoreAudio device UID, also used by ScreenCaptureKit
    let name: String
}

/// Manages ScreenCaptureKit audio capture for both system audio and microphone.
///
/// Default dual-track path: forwards raw `CMSampleBuffer`s to the
/// `AudioEncoder` (one per source) — no mixing, no PCM extraction.
/// Legacy mixed path stays available behind `onMixedSamples` for callers
/// that still want the in-app mixer; both paths share the same
/// **dedicated serial** sample queue so callbacks are strictly ordered.
@Observable
final class AudioCaptureManager: NSObject, @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "AudioCaptureManager")

    /// Callback invoked with mixed PCM samples ready for encoding.
    /// **Legacy path.** Only invoked when non-nil; when nil the manager
    /// skips PCM extraction, mixing, and mixer flush entirely so the
    /// `.dualTrack` recorder pays no mixer cost.
    var onMixedSamples: (([Float]) -> Void)?

    /// Raw system-audio `CMSampleBuffer` callback for the `.dualTrack`
    /// recording path. Called before any extraction/mixing so the
    /// AudioEncoder dual-track input receives untouched SCK PTS.
    var onRawSystemBuffer: ((CMSampleBuffer) -> Void)?

    /// Raw microphone `CMSampleBuffer` callback. Mirror of
    /// `onRawSystemBuffer` for the mic track.
    var onRawMicBuffer: ((CMSampleBuffer) -> Void)?

    /// Callback invoked when the stream stops unexpectedly.
    var onStreamError: ((Error) -> Void)?

    /// Available microphone input devices.
    var availableDevices: [AudioInputDevice] = []

    /// Currently selected microphone device ID. Nil = system default.
    var selectedDeviceID: String?
    private(set) var systemDefaultDeviceID: String?
    // Internal setter also supports the isolated native design fixture.
    var activeInputDevice: AudioInputDevice?
    private(set) var inputRoutingError: String?

    private var stream: SCStream?
    private var streamConfiguration: SCStreamConfiguration?
    /// Picker changes affect the next recording; hardware changes repair this one.
    private var recordingSelectedDeviceID: String?
    private var routeUpdateTask: Task<Void, Never>?
    private var routeNeedsUpdate = false
    private let mixer = AudioMixer()
    private let sampleRate: Int = Constants.Audio.sampleRateInt
    private let channelCount: Int = Constants.Audio.channelCountInt

    /// **Dedicated serial dispatch queue** for SCStream sample handlers.
    /// Required by docs/06: both `.audio` and `.microphone` outputs must
    /// share the same serial queue so `stream(_:didOutputSampleBuffer:of:)`
    /// fires non-concurrently. Using `.global(qos:)` (a concurrent queue)
    /// lets the two output types race into the downstream raw / mixer
    /// callbacks and the encoder; the encoder's own serial queue is a
    /// last-resort guard, not the primary correctness boundary.
    private let sampleQueue = DispatchQueue(
        label: "ai.hexly.lyre.AudioCapture.samples",
        qos: .userInitiated
    )

    /// Counters for debugging audio delivery.
    private var systemAudioBufferCount: Int = 0
    private var micBufferCount: Int = 0

    /// Wall-clock instant that `startCapture()` returned successfully.
    /// Used to compute first-frame arrival latency and total elapsed
    /// time at `stopCapture()`. Reset on each start.
    private var captureStartInstant: Date?

    /// Whichever input UID SCK was actually configured with for this
    /// session, or `nil` when we let SCK pick internally. Persisted so
    /// stop-time diagnostics and first-frame logs can name it without
    /// re-resolving. Reset on each start.
    private var lastEffectiveDevice: EffectiveInputDevice?

    /// Whether the most recent `startCapture()` asked SCK to capture
    /// microphone. Recorded so the stop-time diagnostics snapshot knows
    /// whether "0 mic buffers" was a failure or a system-audio-only
    /// session.
    private var lastCaptureMicrophone: Bool = false

    /// End-of-session snapshot produced by `stopCapture()`. Consumers
    /// (RecordingManager, RecordingActionController) read this after
    /// stop returns to drive non-fatal warnings like mic silence
    /// detection. Reset on each start.
    private(set) var lastCaptureDiagnostics: CaptureDiagnostics?

    /// Injectable read-only probes; tests never need to capture live audio.
    var defaultInputDeviceIDProvider: () -> String? = SystemAudioInputs.defaultDeviceID
    var inputDevicesProvider: () -> [AudioInputDevice] = SystemAudioInputs.devices

    /// Timer that periodically drains the mixer and delivers mixed samples.
    private var drainTimer: Timer?

    private var deviceListener: AudioObjectPropertyListenerBlock?
    private var observedDeviceProperties: [AudioObjectPropertySelector] = []

    deinit {
        routeUpdateTask?.cancel()
        if let deviceListener {
            for selector in observedDeviceProperties {
                var address = SystemAudioInputs.address(selector)
                AudioObjectRemovePropertyListenerBlock(
                    AudioObjectID(kAudioObjectSystemObject), &address, .main, deviceListener
                )
            }
        }
    }

    // MARK: - Capture Control

    /// Start capturing system audio and microphone.
    @MainActor func startCapture() async throws {
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

        refreshDevices()
        recordingSelectedDeviceID = selectedDeviceID
        let effective = resolvedInputDevice
        guard let effectiveID = effective.effectiveID else { throw CaptureError.noMicrophoneFound }

        // Microphone. Never hand SCK a stale UID or an implicit default.
        config.captureMicrophone = true
        config.microphoneCaptureDeviceID = effectiveID
        lastEffectiveDevice = effective
        lastCaptureMicrophone = config.captureMicrophone
        inputRoutingError = nil

        mixer.reset()
        systemAudioBufferCount = 0
        micBufferCount = 0
        captureStartInstant = Date()
        lastCaptureDiagnostics = nil

        let newStream = SCStream(filter: filter, configuration: config, delegate: self)

        // Register separate output handlers for system audio and microphone
        // on the SAME dedicated serial queue (see `sampleQueue` above).
        // Lint rule `lyre_no_global_on_addStreamOutput` (.swiftlint.yml)
        // guards against regressing to `.global(qos:)` here.
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        try newStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: sampleQueue)

        Self.logger.info("""
            Starting capture: mic=\(config.captureMicrophone) \
            selected=\(effective.selectedID ?? "nil") \
            effective=\(effective.effectiveID ?? "nil") \
            source=\(effective.source.rawValue)
            """)

        try await newStream.startCapture()
        stream = newStream
        streamConfiguration = config
        activeInputDevice = availableDevices.first { $0.id == effectiveID }
        // Reconcile any hardware event that arrived while SCK was starting.
        refreshDevices()

        // Start drain timer only when the legacy mixed callback has a
        // consumer. Dual-track recording leaves `onMixedSamples` nil
        // and the timer never arms, so the manager pays no mixer cost.
        // Caller contract: assign `onMixedSamples` before calling
        // `startCapture()` if you need the legacy mixed path.
        if onMixedSamples != nil {
            await MainActor.run {
                drainTimer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in
                    self?.drainMixer()
                }
            }
        }
    }

    /// Stop capturing.
    @MainActor func stopCapture() async throws {
        let updateTask = routeUpdateTask
        updateTask?.cancel()
        routeNeedsUpdate = false
        await updateTask?.value
        defer {
            stream = nil
            streamConfiguration = nil
            activeInputDevice = nil
            inputRoutingError = nil
            recordingSelectedDeviceID = nil
        }
        await MainActor.run {
            drainTimer?.invalidate()
            drainTimer = nil
        }

        let elapsedMs = captureStartInstant.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
        let effectiveLabel = lastEffectiveDevice?.effectiveID ?? "nil"
        Self.logger.info("""
            Stopping capture: systemAudio=\(self.systemAudioBufferCount) buffers, \
            mic=\(self.micBufferCount) buffers, elapsedMs=\(elapsedMs), \
            effective=\(effectiveLabel)
            """)

        // Snapshot BEFORE the throw so a partial-teardown failure still
        // leaves post-hoc diagnostics readable (the counters are frozen
        // for us either way; the throw only says whether SCK's own stop
        // returned cleanly).
        lastCaptureDiagnostics = CaptureDiagnostics(
            micBufferCount: micBufferCount,
            systemAudioBufferCount: systemAudioBufferCount,
            elapsedMs: elapsedMs,
            captureMicrophone: lastCaptureMicrophone,
            effectiveDeviceID: lastEffectiveDevice?.effectiveID
        )

        if let stream {
            try await stream.stopCapture()
        }

        // Flush remaining mixer samples only if the legacy mixed path
        // has a consumer; .dualTrack recording does not push into the
        // mixer and has no leftover PCM to deliver.
        if onMixedSamples != nil {
            let remaining = mixer.flush()
            if !remaining.isEmpty {
                onMixedSamples?(remaining)
            }
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
        case noMicrophoneFound

        var errorDescription: String? {
            switch self {
            case .noDisplayFound:
                return "No display found for ScreenCaptureKit content filter"
            case .noMicrophoneFound:
                return "No microphone is available. Connect a microphone or choose an input in macOS Sound settings."
            }
        }
    }
}

// MARK: - Input routes (control plane stays on the main actor)

extension AudioCaptureManager {
    var resolvedInputDevice: EffectiveInputDevice {
        resolveInput(selected: selectedDeviceID)
    }

    private func resolveInput(selected: String?) -> EffectiveInputDevice {
        InputDeviceResolver.resolve(
            selected: selected,
            availableDefault: systemDefaultDeviceID,
            availableIDs: Set(availableDevices.map(\.id))
        )
    }

    @MainActor func refreshDevices() {
        availableDevices = inputDevicesProvider()
        systemDefaultDeviceID = defaultInputDeviceIDProvider()
        installDeviceChangeListeners()
        scheduleRouteUpdate()
    }

    @MainActor private func installDeviceChangeListeners() {
        if deviceListener == nil {
            deviceListener = { [weak self] _, _ in
                Task { @MainActor in self?.refreshDevices() }
            }
        }
        guard let deviceListener else { return }
        for selector in [kAudioHardwarePropertyDevices, kAudioHardwarePropertyDefaultInputDevice]
            where !observedDeviceProperties.contains(selector) {
            var address = SystemAudioInputs.address(selector)
            let status = AudioObjectAddPropertyListenerBlock(
                AudioObjectID(kAudioObjectSystemObject), &address, .main, deviceListener
            )
            if status == noErr {
                observedDeviceProperties.append(selector)
            } else {
                Self.logger.warning("Input device listener failed: \(status)")
            }
        }
    }

    /// Coalesce Bluetooth reconnect bursts and serialize SCK updates. Stopping
    /// capture cancels and drains this task before closing the stream.
    @MainActor private func scheduleRouteUpdate() {
        guard stream != nil else { return }
        routeNeedsUpdate = true
        guard routeUpdateTask == nil else { return }
        routeUpdateTask = Task { @MainActor [weak self] in
            defer { self?.routeUpdateTask = nil }
            do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            while let self, self.routeNeedsUpdate, !Task.isCancelled {
                self.routeNeedsUpdate = false
                await self.updateMicrophoneRoute()
            }
        }
    }

    @MainActor private func updateMicrophoneRoute() async {
        guard let stream, let config = streamConfiguration else { return }
        let effective = resolveInput(selected: recordingSelectedDeviceID)
        guard effective.effectiveID != lastEffectiveDevice?.effectiveID || inputRoutingError != nil else { return }
        let previousID = config.microphoneCaptureDeviceID
        let previousCapture = config.captureMicrophone
        config.microphoneCaptureDeviceID = effective.effectiveID
        config.captureMicrophone = effective.effectiveID != nil
        do {
            try await stream.updateConfiguration(config)
            // First-frame diagnostics read this on the sample queue.
            sampleQueue.sync { lastEffectiveDevice = effective }
            activeInputDevice = availableDevices.first { $0.id == effective.effectiveID }
            inputRoutingError = effective.effectiveID == nil
                ? "No microphone connected. System audio is still recording." : nil
            Self.logger.info("Microphone route updated: \(effective.effectiveID ?? "unavailable")")
        } catch {
            config.microphoneCaptureDeviceID = previousID
            config.captureMicrophone = previousCapture
            inputRoutingError = "Couldn’t switch the microphone. Check your input before the next recording."
            Self.logger.warning("Microphone route update failed: \(error.localizedDescription)")
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
        handleSampleBuffer(sampleBuffer, outputType: outputType)
    }

    /// Internal sample-buffer dispatch. Exposed for unit tests so the
    /// raw-callback and legacy-mixer paths can be exercised without
    /// constructing a real `SCStream`. Order matters:
    ///   1. raw `CMSampleBuffer` callback (dualTrack path) — fires first
    ///      so the encoder receives untouched SCK PTS.
    ///   2. PCM extraction + mixer push — only when `onMixedSamples`
    ///      has a consumer; the dual-track recorder leaves this nil
    ///      and pays zero PCM/mixer cost.
    func handleSampleBuffer(_ sampleBuffer: CMSampleBuffer, outputType: SCStreamOutputType) {
        guard sampleBuffer.isValid else { return }
        guard outputType == .audio || outputType == .microphone else { return }

        trackBufferCount(outputType, sampleBuffer: sampleBuffer)

        // (1) Raw path — always first, untouched buffer.
        if outputType == .audio {
            onRawSystemBuffer?(sampleBuffer)
        } else {
            onRawMicBuffer?(sampleBuffer)
        }

        // (2) Legacy mixer path — skip entirely when no consumer.
        guard onMixedSamples != nil else { return }
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
            if systemAudioBufferCount == 1 { logFirstFrame(sampleBuffer, label: "SystemAudio") }
        } else {
            micBufferCount += 1
            if micBufferCount == 1 { logFirstFrame(sampleBuffer, label: "Microphone") }
        }
    }

    /// First-frame diagnostic: arrival latency since `startCapture()` +
    /// stream ASBD + the effective device UID SCK was told to use.
    /// Fires exactly once per session per output type — used to prove
    /// whether an "auto no-audio" bug is "buffers never arrived" vs
    /// "buffers arrived but empty" once we correlate with the stop-time
    /// counters.
    private func logFirstFrame(_ sampleBuffer: CMSampleBuffer, label: String) {
        let elapsedMs = captureStartInstant.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
        let effectiveLabel = lastEffectiveDevice?.effectiveID ?? "nil"
        Self.logger.info("""
            \(label) first frame: elapsedMs=\(elapsedMs), effective=\(effectiveLabel)
            """)
        logBufferFormat(sampleBuffer, label: label)
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
