import AVFoundation

/// A bounded, disposable overview of all audio tracks. It never touches the capture pipeline.
enum AudioWaveform {
    enum ReadError: Error { case unreadable }

    static func load(url: URL, count: Int = 100) async throws -> [Float] {
        guard count > 0 else { return [] }
        let task = Task.detached(priority: .utility) { try await decode(url: url, count: count) }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }

    private static func decode(url: URL, count: Int) async throws -> [Float] {
        try Task.checkCancellation()
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard duration.isFinite, duration > 0, !tracks.isEmpty else { throw ReadError.unreadable }
        try Task.checkCancellation()
        let reader = try AVAssetReader(asset: asset)
        let sampleRate = 8_000.0
        let output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: false
        ])
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw ReadError.unreadable }
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? ReadError.unreadable }
        defer { if reader.status == .reading { reader.cancelReading() } }
        var peaks = [Float](repeating: 0, count: count)
        while let buffer = output.copyNextSampleBuffer() {
            try Task.checkCancellation()
            try accumulate(buffer, peaks: &peaks, duration: duration, sampleRate: sampleRate)
        }
        try Task.checkCancellation()
        if reader.status == .failed { throw reader.error ?? ReadError.unreadable }
        guard let peak = peaks.max(), peak > 0 else { return peaks }
        return peaks.map { sqrt($0 / peak) }
    }

    private static func accumulate(
        _ buffer: CMSampleBuffer, peaks: inout [Float], duration: Double, sampleRate: Double
    ) throws {
        guard let block = CMSampleBufferGetDataBuffer(buffer) else { return }
        let length = CMBlockBufferGetDataLength(block)
        guard length > 0, length.isMultiple(of: MemoryLayout<Float>.stride) else { return }
        var samples = [Float](repeating: 0, count: length / MemoryLayout<Float>.stride)
        let status = samples.withUnsafeMutableBytes { bytes in
            guard let base = bytes.baseAddress else { return OSStatus(-1) }
            return CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: base)
        }
        guard status == kCMBlockBufferNoErr else { throw ReadError.unreadable }
        let start = CMSampleBufferGetPresentationTimeStamp(buffer).seconds
        guard start.isFinite else { return }
        for (index, sample) in samples.enumerated() where sample.isFinite {
            let time = start + Double(index) / sampleRate
            let bucket = Int(min(Double(peaks.count - 1), max(0, time / duration * Double(peaks.count))))
            peaks[bucket] = max(peaks[bucket], abs(sample))
        }
    }
}
