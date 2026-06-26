// swiftlint:disable file_length
//
// All helpers extracted from `AudioEncoder` live here. The file is
// thematically a single module of internal encoder plumbing, so keeping
// it together (rather than splitting into a half-dozen 50-line files
// just to satisfy the 400-line cap) keeps the encoder approach easy to
// follow. The main type stays well under its own length budget — this
// file deliberately absorbs the overflow.
import AVFoundation
import os

/// Extracted helpers for `AudioEncoder` — keeps the main type body
/// under the SwiftLint type-body / file-length thresholds. The
/// silent-PCM builder is used by Mitigation B (silent gap fill); the
/// sidecar writer publishes the `Recording_*.tracks.json` role→trackID
/// mapping after a successful dual-track finalize.
extension AudioEncoder {

    // MARK: - Finalize

    /// Finalize the writer, write the sidecar if applicable, and close
    /// the file.
    ///
    /// Throws `EncoderError.writerFailed(...)` if any of:
    ///   - `beginSessionLocked()` during pre-finalize state machine
    ///   - `writeRealBufferLocked()` during the FIFO flush
    ///   - `AVAssetWriter.finishWriting()` itself
    /// reported a failure. `lastError` always mirrors the thrown value
    /// for callers that prefer the surface-and-keep-going pattern.
    /// State is reset under `queue.sync` either way so the next
    /// `setup()` starts clean.
    func finalize() async throws {
        let snapshot = queue.sync { () -> FinalizeSnapshot in
            preFinalizeStateMachineLocked()
            let snap = makeFinalizeSnapshotLocked()
            cancelFirstFrameTimeoutLocked()
            legacyInput?.markAsFinished()
            systemInput?.markAsFinished()
            micInput?.markAsFinished()
            return snap
        }

        guard let writer = snapshot.writer else {
            // No writer at all — clear any cached state and return.
            queue.sync { resetStateLocked(preserveLastError: true) }
            if let err = queue.sync(execute: { lastErrorInternal }) {
                throw err
            }
            return
        }

        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            writer.finishWriting { cont.resume() }
        }

        if writer.status == .failed {
            let detail = writer.error?.localizedDescription ?? "unknown"
            Self.logger.error("Writer finalization failed: \(detail)")
            let thrown: Error = writer.error ?? EncoderError.writerFailed(detail)
            queue.sync {
                lastErrorInternal = thrown
                resetStateLocked(preserveLastError: true)
            }
            throw thrown
        }

        // Sidecar (dual mode only; at least one real source).
        if snapshot.mode == .dualTrack,
           let outputURL = snapshot.outputURL,
           snapshot.systemAppendedReal || snapshot.micAppendedReal {
            await writeSidecarIfPossible(outputURL: outputURL, snapshot: snapshot)
        }

        // Propagate any error captured during pre-finalize FIFO flush
        // (beginSessionLocked → writeRealBufferLocked) since the writer
        // itself may still report `.completed` even if a buffer was
        // dropped mid-flush.
        let pending = queue.sync { () -> Error? in
            let err = lastErrorInternal
            resetStateLocked(preserveLastError: true)
            return err
        }
        if let pending {
            throw pending
        }
    }

    /// Pre-finalize state-machine handling for dualTrack:
    ///   - awaitingAnyFrame: never saw any frame → startSession(.zero)
    ///     so the file closes cleanly. Sidecar will be skipped.
    ///   - awaitingSecondOrTimeout: at least one source has cached
    ///     real buffers but the 500 ms timer has not fired yet.
    ///     Cancel the timer, flush the FIFOs through the normal
    ///     session-start path so cached real audio is not lost.
    ///   - sessionStarted: nothing else to do — just markFinished.
    private func preFinalizeStateMachineLocked() {
        guard mode == .dualTrack, assetWriter?.status == .writing else { return }
        switch sessionState {
        case .awaitingAnyFrame:
            assetWriter?.startSession(atSourceTime: .zero)
        case .awaitingSecondOrTimeout:
            cancelFirstFrameTimeoutLocked()
            do {
                try beginSessionLocked()
            } catch {
                Self.logger.error("finalize(): beginSessionLocked failed: \(error.localizedDescription)")
                lastErrorInternal = error
            }
        case .sessionStarted:
            break
        }
    }

    private func makeFinalizeSnapshotLocked() -> FinalizeSnapshot {
        let stateAwaiting: Bool
        switch sessionState {
        case .awaitingAnyFrame: stateAwaiting = true
        default: stateAwaiting = false
        }
        return FinalizeSnapshot(
            mode: mode,
            writer: assetWriter,
            outputURL: outputURL,
            sessionStateIsAwaitingAnyFrame: stateAwaiting,
            systemAppendedReal: systemAppendedReal,
            micAppendedReal: micAppendedReal,
        )
    }

    /// Reset session/buffer/input state. `preserveLastError=true` keeps
    /// the captured `lastErrorInternal` so callers can inspect why
    /// finalize tore down; `setup()` clears it explicitly on the next
    /// recording start.
    func resetStateLocked(preserveLastError: Bool = false) {
        assetWriter = nil
        outputURL = nil
        legacyInput = nil
        legacyFormat = nil
        legacyTotalSamplesWritten = 0
        systemInput = nil
        micInput = nil
        sessionState = .awaitingAnyFrame
        systemFifo.removeAll()
        micFifo.removeAll()
        systemAppendedAny = false
        micAppendedAny = false
        systemAppendedReal = false
        micAppendedReal = false
        systemLastEndPTS = nil
        micLastEndPTS = nil
        systemLastStartPTS = nil
        micLastStartPTS = nil
        timeoutWorkItem = nil
        if !preserveLastError {
            lastErrorInternal = nil
        }
    }

    // MARK: - Session management (dual)

    func appendToFifo(_ buffer: CMSampleBuffer, source: Source) {
        switch source {
        case .system: systemFifo.append(buffer)
        case .mic:    micFifo.append(buffer)
        }
    }

    func scheduleFirstFrameTimeoutLocked(firstSource: Source) {
        cancelFirstFrameTimeoutLocked()
        sessionState = .awaitingSecondOrTimeout(firstSource: firstSource)
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            // Already on `self.queue` because asyncAfter is dispatched
            // onto it; using queue.sync here would dead-lock.
            if case .awaitingSecondOrTimeout = self.sessionState {
                do {
                    try self.beginSessionLocked()
                } catch {
                    Self.logger.error("First-frame timeout session start failed: \(error.localizedDescription)")
                    self.lastErrorInternal = error
                }
            }
        }
        timeoutWorkItem = work
        queue.asyncAfter(deadline: .now() + .milliseconds(Int(Self.firstFrameTimeoutMs)), execute: work)
    }

    func cancelFirstFrameTimeoutLocked() {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
    }

    func beginSessionLocked() throws {
        guard let writer = assetWriter, writer.status == .writing else { return }

        let candidates: [CMTime] = [
            systemFifo.first.map(CMSampleBufferGetPresentationTimeStamp),
            micFifo.first.map(CMSampleBufferGetPresentationTimeStamp),
        ].compactMap { $0 }
        guard let sessionPTS = candidates.min(by: { CMTimeCompare($0, $1) < 0 }) else { return }
        writer.startSession(atSourceTime: sessionPTS)
        sessionState = .sessionStarted(sessionPTS: sessionPTS)

        // Flush cached buffers in arrival order through the same real-
        // buffer path so Mitigation B and bookkeeping fire uniformly.
        let systemQueued = systemFifo
        let micQueued = micFifo
        systemFifo.removeAll()
        micFifo.removeAll()
        if let sys = systemInput {
            for buf in systemQueued {
                _ = try writeRealBufferLocked(buf, source: .system, input: sys)
            }
        }
        if let mic = micInput {
            for buf in micQueued {
                _ = try writeRealBufferLocked(buf, source: .mic, input: mic)
            }
        }
    }

    // MARK: - Real-buffer append (dual mode)

    /// Append a real source buffer, honouring Mitigation B (silent
    /// gap fill). Drops reverse-PTS buffers with a warning.
    ///
    /// Mitigation A (silent prefix on a late source's first frame) is
    /// NOT implemented on this path: multiple PCM prefix / padded-
    /// first-real / sub-audible-dither attempts were all trimmed away
    /// by AVAssetWriter's PCM→AAC pipeline (verified in task #4 — see
    /// `lateSourceFirstFrameRemainsTrimmedByAVAssetWriter`). The late-
    /// source first buffer is appended as-is; its real PTS still
    /// matches the session timeline, so cross-track alignment for
    /// downstream consumers (ASR, playback) remains correct — only the
    /// late track's leading "edit" range is missing. Task #7's 6DQ
    /// gate, and if needed task #8's downmix fallback, will decide
    /// whether further mitigation is required.
    func writeRealBufferLocked(
        _ buffer: CMSampleBuffer,
        source: Source,
        input: AVAssetWriterInput,
    ) throws -> Bool {
        guard let writer = assetWriter, writer.status == .writing else { return false }
        guard case .sessionStarted = sessionState else { return false }

        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)
        guard CMTIME_IS_VALID(pts) else { return false }

        // Reverse-PTS monotonicity guard — drop with a warning instead
        // of throwing. SCK jitter is real and not an encoder failure.
        if let lastStart = lastStartPTS(source: source),
           CMTimeCompare(pts, lastStart) <= 0 {
            Self.logger.warning("Reverse/duplicate PTS on \(source.rawValue) — dropping buffer")
            return false
        }

        // Mitigation B — silent fill for any same-track PTS gap above
        // the threshold. Unlike Mitigation A, mid-stream silent fills
        // survive the AAC encoder intact (proven by
        // `mitigationBGapFillKeepsTrackDuration`).
        if let lastEnd = lastEndPTS(source: source) {
            try fillGapIfNeeded(GapFillContext(
                input: input,
                source: source,
                lastEnd: lastEnd,
                nextPTS: pts,
                ref: buffer,
                writer: writer,
            ))
        }

        let appended = input.append(buffer)
        if !appended {
            let detail = writer.error?.localizedDescription ?? "unknown"
            throw EncoderError.writerFailed("\(source.rawValue) append failed: \(detail)")
        }
        setAppendedAny(source: source)
        setAppendedReal(source: source)
        setLastStartPTS(source: source, start: pts)
        let endPTS = computeEndPTS(buffer: buffer, startPTS: pts)
        setLastEndPTS(source: source, end: endPTS)
        return true
    }

    private struct GapFillContext {
        let input: AVAssetWriterInput
        let source: Source
        let lastEnd: CMTime
        let nextPTS: CMTime
        let ref: CMSampleBuffer
        let writer: AVAssetWriter
    }

    private func fillGapIfNeeded(_ ctx: GapFillContext) throws {
        let gap = CMTimeSubtract(ctx.nextPTS, ctx.lastEnd)
        let gapMs = CMTimeGetSeconds(gap) * 1_000
        guard gapMs > Self.gapFillThresholdMs else { return }
        let gapFrames = framesBetween(start: ctx.lastEnd, end: ctx.nextPTS)
        guard gapFrames > 0,
              let silent = Self.makeSilentPCMBuffer(
                  matching: ctx.ref,
                  frameCount: gapFrames,
                  startPTS: ctx.lastEnd,
              )
        else { return }
        let ok = ctx.input.append(silent)
        if ok {
            setAppendedAny(source: ctx.source)
            setLastEndPTS(
                source: ctx.source,
                end: CMTimeAdd(
                    ctx.lastEnd,
                    CMTime(value: CMTimeValue(gapFrames), timescale: CMTimeScale(sampleRate)),
                ),
            )
        } else {
            let detail = ctx.writer.error?.localizedDescription ?? "unknown"
            throw EncoderError.writerFailed("silent gap fill append failed: \(detail)")
        }
    }

    func computeEndPTS(buffer: CMSampleBuffer, startPTS: CMTime) -> CMTime {
        let duration = CMSampleBufferGetDuration(buffer)
        if CMTIME_IS_VALID(duration), duration.value > 0 {
            return CMTimeAdd(startPTS, duration)
        }
        let frames = CMSampleBufferGetNumSamples(buffer)
        return CMTimeAdd(startPTS, CMTime(value: CMTimeValue(frames), timescale: CMTimeScale(sampleRate)))
    }

    func framesBetween(start: CMTime, end: CMTime) -> Int {
        let seconds = max(0, CMTimeGetSeconds(end) - CMTimeGetSeconds(start))
        return Int(seconds * sampleRate)
    }

    // MARK: - Per-source bookkeeping accessors

    func inputFor(source: Source) -> AVAssetWriterInput? {
        switch source {
        case .system: return systemInput
        case .mic:    return micInput
        }
    }

    func setAppendedAny(source: Source) {
        switch source {
        case .system: systemAppendedAny = true
        case .mic:    micAppendedAny = true
        }
    }

    func setAppendedReal(source: Source) {
        switch source {
        case .system: systemAppendedReal = true
        case .mic:    micAppendedReal = true
        }
    }

    func lastEndPTS(source: Source) -> CMTime? {
        switch source {
        case .system: return systemLastEndPTS
        case .mic:    return micLastEndPTS
        }
    }

    func setLastEndPTS(source: Source, end: CMTime) {
        switch source {
        case .system: systemLastEndPTS = end
        case .mic:    micLastEndPTS = end
        }
    }

    func lastStartPTS(source: Source) -> CMTime? {
        switch source {
        case .system: return systemLastStartPTS
        case .mic:    return micLastStartPTS
        }
    }

    func setLastStartPTS(source: Source, start: CMTime) {
        switch source {
        case .system: systemLastStartPTS = start
        case .mic:    micLastStartPTS = start
        }
    }

    // MARK: - Legacy sample buffer creation

    func createLegacySampleBufferLocked(from samples: [Float]) -> CMSampleBuffer? {
        let frameCount = samples.count
        guard frameCount > 0, let format = legacyFormat else { return nil }
        guard let formatDescription = format.formatDescription as CMFormatDescription? else {
            return nil
        }

        let pts = CMTime(value: legacyTotalSamplesWritten, timescale: CMTimeScale(sampleRate))
        let duration = CMTime(value: CMTimeValue(frameCount), timescale: CMTimeScale(sampleRate))
        legacyTotalSamplesWritten += Int64(frameCount)

        var timing = CMSampleTimingInfo(
            duration: duration,
            presentationTimeStamp: pts,
            decodeTimeStamp: .invalid,
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
            blockBufferOut: &blockBuffer,
        )
        guard status == kCMBlockBufferNoErr, let block = blockBuffer else { return nil }

        status = samples.withUnsafeBytes { rawBuf in
            CMBlockBufferReplaceDataBytes(
                with: rawBuf.baseAddress!,
                blockBuffer: block,
                offsetIntoDestination: 0,
                dataLength: dataSize,
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
            sampleBufferOut: &sampleBuffer,
        )
        guard status == noErr else { return nil }
        return sampleBuffer
    }

    // MARK: - Silent PCM helper
    /// the reference buffer exactly. Used by Mitigation B (silent
    /// gap fill).
    ///
    /// We construct the silent buffer through the same shape SCK uses
    /// (`AVAudioFormat(streamDescription:)` + `AVAudioPCMBuffer` +
    /// `CMSampleBufferSetDataBufferFromAudioBufferList`) and reuse the
    /// reference's `CMAudioFormatDescription` verbatim. Mid-stream
    /// format-description switches confuse `AVAssetWriterInput`'s AAC
    /// encoder — `append()` returns `true` but the silent frames never
    /// land in the output. Keeping the format identical to the real
    /// stream avoids that pitfall.
    static func makeSilentPCMBuffer(
        matching ref: CMSampleBuffer,
        frameCount: Int,
        startPTS: CMTime,
    ) -> CMSampleBuffer? {
        guard frameCount > 0 else { return nil }
        guard let refFormat = CMSampleBufferGetFormatDescription(ref) else { return nil }
        guard let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(refFormat) else {
            return nil
        }

        // AVAudioFormat takes a pointer into our local copy of the
        // ASBD — keep the copy alive across the call.
        var asbd = asbdPtr.pointee
        guard let format = AVAudioFormat(streamDescription: &asbd) else {
            logger.error("makeSilentPCMBuffer: AVAudioFormat(streamDescription:) failed")
            return nil
        }
        guard let pcm = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frameCount),
        ) else {
            logger.error("makeSilentPCMBuffer: AVAudioPCMBuffer init failed")
            return nil
        }
        pcm.frameLength = AVAudioFrameCount(frameCount)
        // AVAudioPCMBuffer zero-initialises its channel storage.

        var sampleBuffer: CMSampleBuffer?
        var status = CMAudioSampleBufferCreateWithPacketDescriptions(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: refFormat,
            sampleCount: frameCount,
            presentationTimeStamp: startPTS,
            packetDescriptions: nil,
            sampleBufferOut: &sampleBuffer,
        )
        guard status == noErr, let buf = sampleBuffer else {
            logger.error("makeSilentPCMBuffer: CMAudioSampleBufferCreate failed status=\(status)")
            return nil
        }

        status = CMSampleBufferSetDataBufferFromAudioBufferList(
            buf,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            bufferList: pcm.audioBufferList,
        )
        guard status == noErr else {
            logger.error("makeSilentPCMBuffer: SetDataBufferFromAudioBufferList failed status=\(status)")
            return nil
        }
        return buf
    }

    /// Sidecar payload written next to the produced `.m4a` so
    /// downstream consumers (ASR speaker tagging, playback, debug
    /// tooling) can map the real role labels to the finalized
    /// AVAssetTrack `trackID`s.
    ///
    /// docs/06 specifies a flat JSON shape: `{"system": <id>, "mic": <id>}`
    /// (omit the absent role). Keep this contract stable — any envelope
    /// change requires a doc update and a coordinated bump of every
    /// external reader.
    typealias SidecarPayload = [String: Int32]

    /// Reload the freshly-written asset, map role → finalized
    /// trackID, and write `Recording_*.tracks.json`. Failures are
    /// logged but never thrown — the .m4a itself remains usable
    /// without the sidecar.
    func writeSidecarIfPossible(
        outputURL: URL,
        snapshot: FinalizeSnapshot,
    ) async {
        // Reload the asset to read finalized trackIDs. AVURLAsset is
        // non-Sendable so we copy out Int32 values only.
        let asset = AVURLAsset(url: outputURL)
        var trackIDs: [Int32] = []
        do {
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            trackIDs = tracks.map { $0.trackID }
        } catch {
            Self.logger.warning("Sidecar: could not load tracks: \(error.localizedDescription)")
            return
        }

        // Map roles to finalized tracks using the exact `(sysDid, micDid,
        // audioTracks.count)` switch from docs/06 §writeTrackIdentitySidecarLocked.
        // The switch is explicit so the legal combinations and the skip
        // cases are visible at the call site; do not collapse it into a
        // `rolesByIndex` loop — that hides which empty-input branch we
        // are protecting against.
        let payload: SidecarPayload?
        switch (snapshot.systemAppendedReal, snapshot.micAppendedReal, trackIDs.count) {
        case (true, false, 1):
            payload = ["system": trackIDs[0]]
        case (false, true, 1):
            payload = ["mic": trackIDs[0]]
        case (true, true, 2):
            // add() order anchor (Phase 0A track-order probe):
            //   tracks[0] == first add() target == system
            //   tracks[1] == mic
            payload = ["system": trackIDs[0], "mic": trackIDs[1]]
        case (true, true, 1):
            // One input survived final flush as a single track; without
            // role identification on the surviving track we cannot
            // attribute it safely. Skip rather than guess.
            Self.logger.warning(
                "Sidecar: both sources had real frames but asset has 1 track — skipping",
            )
            return
        case (false, false, _):
            return
        default:
            let trackCount = trackIDs.count
            let sysDid = snapshot.systemAppendedReal
            let micDid = snapshot.micAppendedReal
            Self.logger.warning(
                "Sidecar: unexpected (sysDid=\(sysDid), micDid=\(micDid), tracks=\(trackCount)) — skipping",
            )
            return
        }
        guard let payload else { return }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        guard let data = try? encoder.encode(payload) else {
            Self.logger.warning("Sidecar: failed to encode payload")
            return
        }

        let sidecarURL = outputURL
            .deletingPathExtension()
            .appendingPathExtension("tracks.json")
        do {
            try data.write(to: sidecarURL, options: .atomic)
        } catch {
            let name = sidecarURL.lastPathComponent
            Self.logger.warning(
                "Sidecar: failed to write \(name): \(error.localizedDescription)",
            )
        }
    }
}
