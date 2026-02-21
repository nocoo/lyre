import { describe, expect, test } from "bun:test";
import { normalizeAudioFormat } from "@/components/upload-dialog";

describe("normalizeAudioFormat", () => {
  test("normalizes MP3 MIME types", () => {
    expect(normalizeAudioFormat("audio/mpeg")).toBe("mp3");
    expect(normalizeAudioFormat("audio/mp3")).toBe("mp3");
  });

  test("normalizes WAV MIME types", () => {
    expect(normalizeAudioFormat("audio/wav")).toBe("wav");
    expect(normalizeAudioFormat("audio/x-wav")).toBe("wav");
  });

  test("normalizes M4A MIME types", () => {
    expect(normalizeAudioFormat("audio/mp4")).toBe("m4a");
    expect(normalizeAudioFormat("audio/x-m4a")).toBe("m4a");
  });

  test("normalizes other audio MIME types", () => {
    expect(normalizeAudioFormat("audio/aac")).toBe("aac");
    expect(normalizeAudioFormat("audio/ogg")).toBe("ogg");
    expect(normalizeAudioFormat("audio/flac")).toBe("flac");
    expect(normalizeAudioFormat("audio/webm")).toBe("webm");
  });

  test("passes through unknown sub-types as-is", () => {
    expect(normalizeAudioFormat("audio/vorbis")).toBe("vorbis");
  });

  test("returns 'unknown' for missing sub-type", () => {
    expect(normalizeAudioFormat("audio")).toBe("unknown");
  });
});
