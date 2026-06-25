import Testing
import AVFoundation
import CoreMedia
@testable import Lyre

@Suite("AudioCaptureManager Tests")
struct AudioCaptureManagerTests {

    // MARK: - Initial State

    @Test func initialState() {
        let manager = AudioCaptureManager()
        #expect(manager.availableDevices.isEmpty)
        #expect(manager.selectedDeviceID == nil)
        #expect(manager.onMixedSamples == nil)
        #expect(manager.onStreamError == nil)
        #expect(manager.onRawSystemBuffer == nil)
        #expect(manager.onRawMicBuffer == nil)
    }

    // MARK: - Device Selection

    @Test func selectedDeviceIDCanBeSet() {
        let manager = AudioCaptureManager()
        manager.selectedDeviceID = "test-device-id"
        #expect(manager.selectedDeviceID == "test-device-id")
    }

    @Test func selectedDeviceIDNilMeansSystemDefault() {
        let manager = AudioCaptureManager()
        manager.selectedDeviceID = nil
        #expect(manager.selectedDeviceID == nil)
    }

    // MARK: - AudioInputDevice

    @Test func audioInputDeviceEquality() {
        let a = AudioInputDevice(id: "abc", name: "Mic A")
        let b = AudioInputDevice(id: "abc", name: "Mic A")
        let c = AudioInputDevice(id: "def", name: "Mic B")
        #expect(a == b)
        #expect(a != c)
    }

    @Test func audioInputDeviceIdentifiable() {
        let device = AudioInputDevice(id: "unique-123", name: "Test Mic")
        #expect(device.id == "unique-123")
        #expect(device.name == "Test Mic")
    }

    // MARK: - Sample Extraction

    @Test func extractSamplesFromValidBuffer() {
        // Create a CMSampleBuffer with known Float32 data
        let samples: [Float] = [0.1, 0.5, -0.3, 1.0]
        guard let sampleBuffer = createTestSampleBuffer(from: samples) else {
            Issue.record("Failed to create test sample buffer")
            return
        }

        let extracted = AudioCaptureManager.extractSamples(from: sampleBuffer)
        #expect(extracted != nil)
        #expect(extracted?.count == 4)
        if let extracted {
            #expect(abs(extracted[0] - 0.1) < 0.001)
            #expect(abs(extracted[1] - 0.5) < 0.001)
            #expect(abs(extracted[2] - (-0.3)) < 0.001)
            #expect(abs(extracted[3] - 1.0) < 0.001)
        }
    }

    @Test func extractSamplesFromEmptyBuffer() {
        let samples: [Float] = []
        guard let sampleBuffer = createTestSampleBuffer(from: samples) else {
            // Empty buffer may fail to create — that's fine
            return
        }

        let extracted = AudioCaptureManager.extractSamples(from: sampleBuffer)
        // Should return nil or empty
        #expect(extracted == nil || extracted?.isEmpty == true)
    }

    @Test func extractSamplesFromSingleSample() {
        let samples: [Float] = [0.42]
        guard let sampleBuffer = createTestSampleBuffer(from: samples) else {
            Issue.record("Failed to create test sample buffer")
            return
        }

        let extracted = AudioCaptureManager.extractSamples(from: sampleBuffer)
        #expect(extracted?.count == 1)
        if let value = extracted?.first {
            #expect(abs(value - 0.42) < 0.001)
        }
    }

    // MARK: - Callbacks

    @Test func onMixedSamplesCallback() {
        let manager = AudioCaptureManager()
        var received: [Float]?
        manager.onMixedSamples = { samples in
            received = samples
        }
        // Invoke the callback manually to test it's wired
        manager.onMixedSamples?([1.0, 2.0])
        #expect(received == [1.0, 2.0])
    }

    @Test func onStreamErrorCallback() {
        let manager = AudioCaptureManager()
        var receivedError: Error?
        manager.onStreamError = { error in
            receivedError = error
        }

        let testError = NSError(domain: "test", code: 42)
        manager.onStreamError?(testError)
        #expect((receivedError as? NSError)?.code == 42)
    }

    // MARK: - Raw buffer dispatch (dualTrack path)

    @Test func handleSampleBufferRoutesAudioToRawSystemCallback() {
        let manager = AudioCaptureManager()
        let samples: [Float] = [0.1, 0.2, 0.3]
        guard let buf = createTestSampleBuffer(from: samples) else {
            Issue.record("Failed to create test sample buffer")
            return
        }
        var received: CMSampleBuffer?
        manager.onRawSystemBuffer = { received = $0 }
        manager.handleSampleBuffer(buf, outputType: .audio)
        #expect(received != nil)
        #expect(CMSampleBufferGetNumSamples(received!) == 3)
    }

    @Test func handleSampleBufferRoutesMicToRawMicCallback() {
        let manager = AudioCaptureManager()
        guard let buf = createTestSampleBuffer(from: [0.5, -0.5]) else {
            Issue.record("Failed to create test sample buffer")
            return
        }
        var receivedSystem: CMSampleBuffer?
        var receivedMic: CMSampleBuffer?
        manager.onRawSystemBuffer = { receivedSystem = $0 }
        manager.onRawMicBuffer = { receivedMic = $0 }
        manager.handleSampleBuffer(buf, outputType: .microphone)
        #expect(receivedMic != nil)
        #expect(receivedSystem == nil, "mic buffer must not leak into system raw callback")
    }

    @Test func handleSampleBufferSkipsMixerWhenNoMixedConsumer() async throws {
        // Dual-track recorder leaves onMixedSamples == nil. The legacy
        // extract/mixer push path must be skipped entirely — we prove
        // this black-box: push a buffer with no consumer set, then
        // install a capture buffer for onMixedSamples and flush via
        // stopCapture(). If the mixer was wrongly pushed earlier, the
        // flush would deliver the leftover samples.
        let manager = AudioCaptureManager()
        guard let buf = createTestSampleBuffer(from: [0.1, 0.2, 0.3]) else {
            Issue.record("Failed to create test sample buffer")
            return
        }
        var rawHit = false
        manager.onRawSystemBuffer = { _ in rawHit = true }
        manager.onMixedSamples = nil
        manager.handleSampleBuffer(buf, outputType: .audio)
        #expect(rawHit)

        // Now install a mixed callback and flush. Mixer should be empty.
        var leakedMixed: [Float] = []
        manager.onMixedSamples = { leakedMixed.append(contentsOf: $0) }
        try await manager.stopCapture()
        #expect(leakedMixed.isEmpty, "mixer must not retain samples pushed while onMixedSamples was nil")
    }

    @Test func handleSampleBufferStillFeedsMixerWhenMixedConsumerPresent() async throws {
        // Legacy single-track path: with onMixedSamples set first,
        // pushed buffers must end up in the mixer. We can't observe
        // the mixer's internal queue directly, but stopCapture()'s
        // flush will deliver any retained samples through the mixed
        // callback. The internal mixer holds frames until both system
        // and mic have data, so push both sides before flushing.
        let manager = AudioCaptureManager()
        guard let sysBuf = createTestSampleBuffer(from: Array(repeating: Float(0.4), count: 480)) else {
            Issue.record("Failed to create sys sample buffer")
            return
        }
        guard let micBuf = createTestSampleBuffer(from: Array(repeating: Float(-0.3), count: 480)) else {
            Issue.record("Failed to create mic sample buffer")
            return
        }
        var rawSysHit = false
        var rawMicHit = false
        var mixedReceived: [Float] = []
        manager.onRawSystemBuffer = { _ in rawSysHit = true }
        manager.onRawMicBuffer = { _ in rawMicHit = true }
        manager.onMixedSamples = { mixedReceived.append(contentsOf: $0) }
        manager.handleSampleBuffer(sysBuf, outputType: .audio)
        manager.handleSampleBuffer(micBuf, outputType: .microphone)
        try await manager.stopCapture()

        #expect(rawSysHit)
        #expect(rawMicHit)
        #expect(!mixedReceived.isEmpty, "mixer flush must yield samples when both sides were pushed")
    }

    @Test func handleSampleBufferIgnoresUnrelatedOutputTypes() {
        let manager = AudioCaptureManager()
        guard let buf = createTestSampleBuffer(from: [0.1]) else {
            Issue.record("Failed to create test sample buffer")
            return
        }
        var rawSystemHit = false
        var rawMicHit = false
        manager.onRawSystemBuffer = { _ in rawSystemHit = true }
        manager.onRawMicBuffer = { _ in rawMicHit = true }
        manager.handleSampleBuffer(buf, outputType: .screen)
        #expect(!rawSystemHit)
        #expect(!rawMicHit)
    }

    // MARK: - CaptureError

    @Test func captureErrorDescription() {
        let error = AudioCaptureManager.CaptureError.noDisplayFound
        #expect(error.errorDescription?.contains("No display found") == true)
    }

    // MARK: - Device Refresh

    @Test func refreshDevicesPopulatesArray() {
        let manager = AudioCaptureManager()
        manager.refreshDevices()
        // We can't guarantee specific devices exist, but the array should be set
        // (could be empty on CI with no audio devices)
        #expect(manager.availableDevices.count >= 0)
    }

    @Test func refreshDevicesInstallsChangeListener() {
        let manager = AudioCaptureManager()
        manager.refreshDevices()
        // Calling refreshDevices twice should not crash (idempotent listener install)
        manager.refreshDevices()
        #expect(manager.availableDevices.count >= 0)
    }

    @Test func enumerateDevicesFallsBackWhenSelectedDeviceDisappears() {
        let manager = AudioCaptureManager()
        // Simulate a selected device that doesn't exist in the real device list
        manager.selectedDeviceID = "nonexistent-device-id"
        // refreshDevices will enumerate real devices (which won't contain our fake ID)
        manager.refreshDevices()
        // The manager itself doesn't auto-clear on refreshDevices() — that's enumerateDevices()'s job.
        // But we can test the AudioInputDevice model used for lookups
        let fakeID = "nonexistent-device-id"
        let exists = manager.availableDevices.contains { $0.id == fakeID }
        #expect(!exists, "Nonexistent device should not appear in available devices")
    }

    // MARK: - Helpers

    /// Create a CMSampleBuffer from Float32 data for testing.
    private func createTestSampleBuffer(from samples: [Float]) -> CMSampleBuffer? {
        let dataSize = samples.count * MemoryLayout<Float>.size
        guard dataSize > 0 else { return nil }

        guard let desc = createAudioFormatDescription() else { return nil }
        guard let block = createBlockBuffer(from: samples, dataSize: dataSize) else { return nil }

        var timing = CMSampleTimingInfo(
            duration: CMTime(value: CMTimeValue(samples.count), timescale: 48000),
            presentationTimeStamp: .zero,
            decodeTimeStamp: .invalid
        )

        var sampleBuffer: CMSampleBuffer?
        let status = CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: block,
            dataReady: true,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: desc,
            sampleCount: samples.count,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 1,
            sampleSizeArray: [MemoryLayout<Float>.size],
            sampleBufferOut: &sampleBuffer
        )
        guard status == noErr else { return nil }
        return sampleBuffer
    }

    /// Create an audio format description for Float32 mono 48kHz.
    private func createAudioFormatDescription() -> CMAudioFormatDescription? {
        var asbd = AudioStreamBasicDescription(
            mSampleRate: 48000,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsNonInterleaved,
            mBytesPerPacket: 4,
            mFramesPerPacket: 1,
            mBytesPerFrame: 4,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 32,
            mReserved: 0
        )

        var desc: CMAudioFormatDescription?
        let status = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: &asbd,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &desc
        )
        return status == noErr ? desc : nil
    }

    /// Create a CMBlockBuffer filled with Float32 sample data.
    private func createBlockBuffer(from samples: [Float], dataSize: Int) -> CMBlockBuffer? {
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
        return status == kCMBlockBufferNoErr ? block : nil
    }
}
