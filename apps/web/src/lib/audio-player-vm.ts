/**
 * Audio Player View Model
 *
 * Pure functions for formatting audio player state.
 * The actual audio playback is handled by the component via HTMLAudioElement.
 */

/** Playback speed options */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Format seconds to MM:SS display (e.g. 127.3 → "2:07") */
export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Calculate progress percentage (0–100) */
export function calculateProgress(
  currentTime: number,
  duration: number,
): number {
  if (duration <= 0 || !Number.isFinite(duration)) return 0;
  return Math.min(100, Math.max(0, (currentTime / duration) * 100));
}

/** Convert a progress percentage (0–100) back to seconds */
export function progressToTime(progress: number, duration: number): number {
  if (duration <= 0 || !Number.isFinite(duration)) return 0;
  return Math.min(duration, Math.max(0, (progress / 100) * duration));
}

/** Get the next playback speed in the cycle */
export function cyclePlaybackSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const idx = PLAYBACK_SPEEDS.indexOf(current);
  const nextIdx = (idx + 1) % PLAYBACK_SPEEDS.length;
  return PLAYBACK_SPEEDS[nextIdx]!;
}

/** Format playback speed for display (e.g. 1 → "1×", 1.5 → "1.5×") */
export function formatPlaybackSpeed(speed: PlaybackSpeed): string {
  return `${speed}×`;
}

export interface AudioPlayerVM {
  currentTimeDisplay: string;
  durationDisplay: string;
  progress: number;
  speedDisplay: string;
}

export function toAudioPlayerVM(
  currentTime: number,
  duration: number,
  speed: PlaybackSpeed,
): AudioPlayerVM {
  return {
    currentTimeDisplay: formatPlayerTime(currentTime),
    durationDisplay: formatPlayerTime(duration),
    progress: calculateProgress(currentTime, duration),
    speedDisplay: formatPlaybackSpeed(speed),
  };
}
