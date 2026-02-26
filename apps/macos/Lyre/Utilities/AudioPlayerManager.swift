import SwiftUI
import AVFoundation

/// Simple audio player wrapper for AVAudioPlayer.
@Observable
final class AudioPlayerManager: NSObject, @unchecked Sendable, AVAudioPlayerDelegate {
    enum PlaybackState: Equatable {
        case stopped
        case playing(URL)
        case paused(URL)
    }

    internal(set) var state: PlaybackState = .stopped
    internal(set) var currentTime: TimeInterval = 0
    internal(set) var duration: TimeInterval = 0

    private var player: AVAudioPlayer?
    private var timer: Timer?

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
        // If already playing this file, resume
        if case .paused(let u) = state, u == url {
            player?.play()
            state = .playing(url)
            startTimer()
            return
        }

        // Stop any current playback
        stop()

        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.prepareToPlay()
            p.play()
            player = p
            duration = p.duration
            currentTime = 0
            state = .playing(url)
            startTimer()
        } catch {
            // Silently fail — could log via os.Logger
        }
    }

    /// Pause the current playback.
    func pause() {
        guard case .playing(let url) = state else { return }
        player?.pause()
        state = .paused(url)
        stopTimer()
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
        player?.stop()
        player = nil
        state = .stopped
        currentTime = 0
        duration = 0
        stopTimer()
    }

    // MARK: - AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.stop()
        }
    }

    // MARK: - Timer

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, let p = self.player else { return }
            self.currentTime = p.currentTime
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}
