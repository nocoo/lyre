import AVFoundation
import Foundation

enum AudioDownmixer {
    enum DownmixError: LocalizedError {
        case noAudioTracks
        case encodeFailed(String)

        var errorDescription: String? {
            switch self {
            case .noAudioTracks: "Source has no audio tracks"
            case .encodeFailed(let message): "Audio conversion failed: \(message)"
            }
        }
    }

    static func downmix(source: URL, destination: URL) async throws {
        let asset = AVURLAsset(url: source)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard !tracks.isEmpty else { throw DownmixError.noAudioTracks }
        try Task.checkCancellation()
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        if tracks.count == 1 {
            try FileManager.default.copyItem(at: source, to: destination)
            return
        }
        try await convert(asset: asset, tracks: tracks, destination: destination, wav: false)
    }

    static func makeWhisperWAV(source: URL, destination: URL) async throws {
        let asset = AVURLAsset(url: source)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard !tracks.isEmpty else { throw DownmixError.noAudioTracks }
        try Task.checkCancellation()
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try await convert(asset: asset, tracks: tracks, destination: destination, wav: true)
    }

    private static func convert(
        asset: AVAsset, tracks: [AVAssetTrack], destination: URL, wav: Bool
    ) async throws {
        let sampleRate = wav ? 16_000.0 : Constants.Audio.sampleRate
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: .zero, duration: try await asset.load(.duration))
        let output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        let mix = AVMutableAudioMix()
        mix.inputParameters = tracks.map { track in
            let parameters = AVMutableAudioMixInputParameters(track: track)
            parameters.setVolume(1 / Float(tracks.count), at: .zero)
            return parameters
        }
        output.audioMix = mix
        guard reader.canAdd(output) else { throw DownmixError.encodeFailed("Cannot mix source tracks") }
        reader.add(output)
        let writer = try AVAssetWriter(outputURL: destination, fileType: wav ? .wav : .m4a)
        writer.shouldOptimizeForNetworkUse = !wav
        var settings: [String: Any] = [AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1]
        if wav {
            settings.merge([
                AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]) { _, new in new }
        } else {
            settings[AVFormatIDKey] = kAudioFormatMPEG4AAC
            settings[AVEncoderBitRateKey] = Constants.Audio.aacBitRate
        }
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { throw DownmixError.encodeFailed("Cannot encode mixed audio") }
        writer.add(input)
        do {
            try await pump(reader: reader, output: output, writer: writer, input: input)
        } catch {
            reader.cancelReading()
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    private static func pump(
        reader: AVAssetReader, output: AVAssetReaderAudioMixOutput,
        writer: AVAssetWriter, input: AVAssetWriterInput
    ) async throws {
        guard reader.startReading(), writer.startWriting() else {
            throw DownmixError.encodeFailed(
                reader.error?.localizedDescription ?? writer.error?.localizedDescription ?? "Cannot start conversion"
            )
        }
        writer.startSession(atSourceTime: .zero)
        while let buffer = output.copyNextSampleBuffer() {
            try Task.checkCancellation()
            while !input.isReadyForMoreMediaData {
                guard writer.status == .writing else {
                    throw DownmixError.encodeFailed(writer.error?.localizedDescription ?? "Writer stopped")
                }
                try await Task.sleep(for: .milliseconds(5))
            }
            guard input.append(buffer) else {
                throw DownmixError.encodeFailed(writer.error?.localizedDescription ?? "Cannot write mixed audio")
            }
        }
        try Task.checkCancellation()
        guard reader.status == .completed else {
            throw DownmixError.encodeFailed(reader.error?.localizedDescription ?? "Cannot read source audio")
        }
        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else {
            throw DownmixError.encodeFailed(writer.error?.localizedDescription ?? "Cannot finish conversion")
        }
    }
}
