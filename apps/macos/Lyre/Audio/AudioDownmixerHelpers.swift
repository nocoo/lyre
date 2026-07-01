import AVFoundation
import CoreMedia
import Foundation

/// CMSampleBuffer plumbing for AudioDownmixer. Kept separate so the
/// top-level downmix flow reads cleanly; nothing here is aware of the
/// mixing strategy.
extension AudioDownmixer {

    /// Copy the mono Float32 samples out of a CMSampleBuffer produced by
    /// AVAssetReaderTrackOutput with our PCM settings.
    static func extractMonoFloats(
        from sb: CMSampleBuffer
    ) -> (floats: [Float], pts: CMTime)? {
        guard let block = CMSampleBufferGetDataBuffer(sb) else { return nil }
        let length = CMBlockBufferGetDataLength(block)
        let frameCount = length / MemoryLayout<Float>.size
        guard frameCount > 0 else { return nil }

        var floats = [Float](repeating: 0, count: frameCount)
        let status = floats.withUnsafeMutableBytes { buf -> OSStatus in
            CMBlockBufferCopyDataBytes(
                block,
                atOffset: 0,
                dataLength: length,
                destination: buf.baseAddress!
            )
        }
        guard status == kCMBlockBufferNoErr else { return nil }

        return (floats, CMSampleBufferGetPresentationTimeStamp(sb))
    }

    /// Wrap a `[Float]` mono PCM chunk in a CMSampleBuffer the AAC writer
    /// input will accept.
    static func makeSampleBuffer(
        floats: [Float],
        pts: CMTime,
        sampleRate: Double
    ) -> CMSampleBuffer? {
        guard let fmt = makeMonoFloatFormatDesc(sampleRate: sampleRate) else { return nil }
        guard let bb = makeBlockBuffer(floats: floats) else { return nil }

        var sampleBuffer: CMSampleBuffer?
        var sampleSize = 4
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: CMTimeScale(sampleRate)),
            presentationTimeStamp: pts,
            decodeTimeStamp: .invalid
        )
        let status = CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: bb,
            formatDescription: fmt,
            sampleCount: floats.count,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 1,
            sampleSizeArray: &sampleSize,
            sampleBufferOut: &sampleBuffer
        )
        guard status == noErr else { return nil }
        return sampleBuffer
    }

    /// Build a CMAudioFormatDescription describing mono Float32 PCM at
    /// the target sample rate. Matches what AVAssetReaderTrackOutput
    /// hands us and what CMSampleBufferCreateReady wants back.
    static func makeMonoFloatFormatDesc(sampleRate: Double) -> CMAudioFormatDescription? {
        var asbd = AudioStreamBasicDescription(
            mSampleRate: sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 4,
            mFramesPerPacket: 1,
            mBytesPerFrame: 4,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 32,
            mReserved: 0
        )

        var formatDesc: CMAudioFormatDescription?
        let status = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: &asbd,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &formatDesc
        )
        guard status == noErr else { return nil }
        return formatDesc
    }

    /// Copy a Float32 array into a fresh CMBlockBuffer sized to the array.
    static func makeBlockBuffer(floats: [Float]) -> CMBlockBuffer? {
        let byteCount = floats.count * MemoryLayout<Float>.size
        var blockBuffer: CMBlockBuffer?
        var status = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: byteCount,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: byteCount,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == kCMBlockBufferNoErr, let bb = blockBuffer else { return nil }

        status = floats.withUnsafeBytes { buf -> OSStatus in
            CMBlockBufferReplaceDataBytes(
                with: buf.baseAddress!,
                blockBuffer: bb,
                offsetIntoDestination: 0,
                dataLength: byteCount
            )
        }
        guard status == kCMBlockBufferNoErr else { return nil }
        return bb
    }
}
