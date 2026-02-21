import { describe, expect, test } from "bun:test";
import {
  formatPlayerTime,
  calculateProgress,
  progressToTime,
  cyclePlaybackSpeed,
  formatPlaybackSpeed,
  toAudioPlayerVM,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "@/lib/audio-player-vm";

// ── formatPlayerTime ──

describe("formatPlayerTime", () => {
  test("formats 0 seconds", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
  });

  test("formats seconds under a minute", () => {
    expect(formatPlayerTime(5)).toBe("0:05");
    expect(formatPlayerTime(30)).toBe("0:30");
    expect(formatPlayerTime(59)).toBe("0:59");
  });

  test("formats exact minutes", () => {
    expect(formatPlayerTime(60)).toBe("1:00");
    expect(formatPlayerTime(120)).toBe("2:00");
    expect(formatPlayerTime(600)).toBe("10:00");
  });

  test("formats minutes and seconds", () => {
    expect(formatPlayerTime(127.3)).toBe("2:07");
    expect(formatPlayerTime(1847.5)).toBe("30:47");
  });

  test("pads seconds with leading zero", () => {
    expect(formatPlayerTime(61)).toBe("1:01");
    expect(formatPlayerTime(69)).toBe("1:09");
  });

  test("handles NaN", () => {
    expect(formatPlayerTime(NaN)).toBe("0:00");
  });

  test("handles Infinity", () => {
    expect(formatPlayerTime(Infinity)).toBe("0:00");
  });

  test("handles negative values", () => {
    expect(formatPlayerTime(-10)).toBe("0:00");
  });

  test("truncates fractional seconds (floor)", () => {
    expect(formatPlayerTime(59.9)).toBe("0:59");
    expect(formatPlayerTime(60.1)).toBe("1:00");
  });
});

// ── calculateProgress ──

describe("calculateProgress", () => {
  test("returns 0 when currentTime is 0", () => {
    expect(calculateProgress(0, 100)).toBe(0);
  });

  test("returns 50 at midpoint", () => {
    expect(calculateProgress(50, 100)).toBe(50);
  });

  test("returns 100 at end", () => {
    expect(calculateProgress(100, 100)).toBe(100);
  });

  test("clamps to 100 when currentTime exceeds duration", () => {
    expect(calculateProgress(150, 100)).toBe(100);
  });

  test("clamps to 0 for negative currentTime", () => {
    expect(calculateProgress(-10, 100)).toBe(0);
  });

  test("returns 0 for zero duration", () => {
    expect(calculateProgress(50, 0)).toBe(0);
  });

  test("returns 0 for negative duration", () => {
    expect(calculateProgress(50, -10)).toBe(0);
  });

  test("returns 0 for NaN duration", () => {
    expect(calculateProgress(50, NaN)).toBe(0);
  });

  test("handles fractional values", () => {
    expect(calculateProgress(1, 3)).toBeCloseTo(33.333, 2);
  });
});

// ── progressToTime ──

describe("progressToTime", () => {
  test("returns 0 for 0%", () => {
    expect(progressToTime(0, 100)).toBe(0);
  });

  test("returns midpoint for 50%", () => {
    expect(progressToTime(50, 100)).toBe(50);
  });

  test("returns duration for 100%", () => {
    expect(progressToTime(100, 100)).toBe(100);
  });

  test("clamps to duration for >100%", () => {
    expect(progressToTime(150, 100)).toBe(100);
  });

  test("clamps to 0 for negative progress", () => {
    expect(progressToTime(-10, 100)).toBe(0);
  });

  test("returns 0 for zero duration", () => {
    expect(progressToTime(50, 0)).toBe(0);
  });

  test("handles real-world values", () => {
    expect(progressToTime(25, 1847.5)).toBeCloseTo(461.875, 2);
  });
});

// ── cyclePlaybackSpeed ──

describe("cyclePlaybackSpeed", () => {
  test("cycles from 0.5 to 0.75", () => {
    expect(cyclePlaybackSpeed(0.5)).toBe(0.75);
  });

  test("cycles from 0.75 to 1", () => {
    expect(cyclePlaybackSpeed(0.75)).toBe(1);
  });

  test("cycles from 1 to 1.25", () => {
    expect(cyclePlaybackSpeed(1)).toBe(1.25);
  });

  test("cycles from 1.25 to 1.5", () => {
    expect(cyclePlaybackSpeed(1.25)).toBe(1.5);
  });

  test("cycles from 1.5 to 2", () => {
    expect(cyclePlaybackSpeed(1.5)).toBe(2);
  });

  test("wraps from 2 back to 0.5", () => {
    expect(cyclePlaybackSpeed(2)).toBe(0.5);
  });

  test("all speeds are accounted for", () => {
    let speed: PlaybackSpeed = PLAYBACK_SPEEDS[0]!;
    const visited = new Set<PlaybackSpeed>();
    for (let i = 0; i < PLAYBACK_SPEEDS.length; i++) {
      visited.add(speed);
      speed = cyclePlaybackSpeed(speed);
    }
    expect(visited.size).toBe(PLAYBACK_SPEEDS.length);
    expect(speed).toBe(PLAYBACK_SPEEDS[0]!); // back to start
  });
});

// ── formatPlaybackSpeed ──

describe("formatPlaybackSpeed", () => {
  test("formats 1× speed", () => {
    expect(formatPlaybackSpeed(1)).toBe("1×");
  });

  test("formats fractional speeds", () => {
    expect(formatPlaybackSpeed(0.5)).toBe("0.5×");
    expect(formatPlaybackSpeed(1.5)).toBe("1.5×");
  });

  test("formats 2× speed", () => {
    expect(formatPlaybackSpeed(2)).toBe("2×");
  });
});

// ── toAudioPlayerVM ──

describe("toAudioPlayerVM", () => {
  test("creates VM with default state", () => {
    const vm = toAudioPlayerVM(0, 100, 1);
    expect(vm.currentTimeDisplay).toBe("0:00");
    expect(vm.durationDisplay).toBe("1:40");
    expect(vm.progress).toBe(0);
    expect(vm.speedDisplay).toBe("1×");
  });

  test("creates VM at midpoint", () => {
    const vm = toAudioPlayerVM(50, 100, 1);
    expect(vm.currentTimeDisplay).toBe("0:50");
    expect(vm.progress).toBe(50);
  });

  test("creates VM with different speed", () => {
    const vm = toAudioPlayerVM(0, 60, 1.5);
    expect(vm.speedDisplay).toBe("1.5×");
  });

  test("handles real-world recording duration", () => {
    const vm = toAudioPlayerVM(923.75, 1847.5, 1);
    expect(vm.currentTimeDisplay).toBe("15:23");
    expect(vm.durationDisplay).toBe("30:47");
    expect(vm.progress).toBe(50);
  });

  test("handles zero duration", () => {
    const vm = toAudioPlayerVM(0, 0, 1);
    expect(vm.durationDisplay).toBe("0:00");
    expect(vm.progress).toBe(0);
  });
});
