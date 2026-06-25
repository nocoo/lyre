import AVFoundation
import Observation
import os

/// Audio player wrapper around `AVPlayer`.
///
/// `AVAudioPlayer(contentsOf:)` only plays the first audio track of a
/// container, so a dual-track `.m4a` produced by the docs/06 recorder
/// rewrite would have its second track silently dropped. `AVPlayer`
/// composes every enabled track in the asset, which is what we need
/// once `AudioEncoder` starts writing two `AVAssetWriterInput`s.
///
/// The external surface (`play`, `pause`, `toggle`, `stop`, `state`,
/// `currentTime`, `duration`, `isActive`, `isPlaying`) is preserved so
/// SwiftUI callers do not have to change.
@Observable
final class AudioPlayerManager: NSObject, @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "AudioPlayerManager")

    enum PlaybackState: Equatable {
        case stopped
        case playing(URL)
        case paused(URL)
    }

    internal(set) var state: PlaybackState = .stopped
    internal(set) var currentTime: TimeInterval = 0
    internal(set) var duration: TimeInterval = 0

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    /// Identifies the current playback "generation". Every `play()` /
    /// `stop()` invalidates the previous generation so async work
    /// (e.g. `AVURLAsset.load(.duration)`) launched against an older
    /// generation can no-op when it finally lands. Without this, an A->B
    /// switch (or play->stop) where A's duration load resolves late would
    /// stomp `self.duration` with the previous file's value.
    private var generation: UInt64 = 0

    /// Whether the given URL is currently being played or paused.
    func isActive(_ url: URL) -> Bool {
        switch state {
        case .playing(let u), .paused(let u):
            return u == url
        case .stopped:
            return false
        }
    }

    func isPlaying(_ url: URL) -> Bool {
        if case .playing(let u) = state { return u == url }
        return false
    }

    /// Play or resume a recording.
    func play(_ url: URL) {
        // Resume if we are already paused on the same URL — keeps the
        // current play head and avoids re-loading the asset.
        if case .paused(let u) = state, u == url, let p = player {
            p.play()
            state = .playing(url)
            return
        }

        // Stop any current playback (drops the previous AVPlayerItem +
        // observers).
        stop()

        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        let p = AVPlayer(playerItem: item)
        p.actionAtItemEnd = .pause
        player = p
        generation &+= 1
        let myGeneration = generation

        // Duration loads asynchronously on AVAsset. We seed it from the
        // asset's duration once it resolves, but only if no `play()` /
        // `stop()` has fired in the meantime — otherwise A->B / play->
        // stop would let A's late duration stomp B's value.
        Task { [weak self] in
            guard let self else { return }
            do {
                let cm = try await asset.load(.duration)
                let seconds = CMTimeGetSeconds(cm)
                await MainActor.run {
                    guard self.generation == myGeneration else { return }
                    if seconds.isFinite, seconds > 0 {
                        self.duration = seconds
                    }
                }
            } catch {
                Self.logger.warning("Failed to load duration: \(error.localizedDescription)")
            }
        }

        // Periodic time observer drives the `currentTime` property the
        // same way the old NSTimer did, but tied to the player clock so
        // it pauses automatically when playback pauses.
        let interval = CMTime(seconds: 0.1, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = p.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            self.currentTime = CMTimeGetSeconds(time)
        }

        // End-of-playback notification — AVPlayer doesn't have a
        // delegate, so we listen for the standard item-did-play-to-end
        // notification and fold it into `stop()`.
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main,
        ) { [weak self] _ in
            self?.stop()
        }

        currentTime = 0
        // Avoid stale duration leaking from a previous file; the async
        // load above replaces it as soon as the asset is ready.
        duration = 0
        state = .playing(url)
        p.play()
    }

    /// Pause the current playback.
    func pause() {
        guard case .playing(let url) = state else { return }
        player?.pause()
        state = .paused(url)
    }

    /// Toggle play/pause for the given URL.
    func toggle(_ url: URL) {
        if isPlaying(url) {
            pause()
        } else {
            play(url)
        }
    }

    /// Stop playback entirely.
    func stop() {
        // Invalidate any in-flight duration loads / generation-tagged
        // callbacks before tearing the player down.
        generation &+= 1
        if let observer = timeObserver, let p = player {
            p.removeTimeObserver(observer)
        }
        timeObserver = nil
        if let end = endObserver {
            NotificationCenter.default.removeObserver(end)
        }
        endObserver = nil
        player?.pause()
        player = nil
        state = .stopped
        currentTime = 0
        duration = 0
    }
}
