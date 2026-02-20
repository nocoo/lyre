import { describe, expect, test } from "bun:test";
import {
  toRecordingMetadataVM,
  toTranscriptionVM,
  toJobStatusVM,
  toRecordingDetailVM,
  formatTimestamp,
  countWords,
  computeProcessingDuration,
  toSentenceVM,
  findActiveSentenceIndex,
} from "@/lib/recording-detail-vm";
import { MOCK_RECORDING_DETAILS } from "@/lib/mock-data";
import type { RecordingDetail, TranscriptionSentence } from "@/lib/types";

// Get mock details by status
const completedDetail = MOCK_RECORDING_DETAILS.find(
  (d) => d.id === "rec-001",
)!;
const transcribingDetail = MOCK_RECORDING_DETAILS.find(
  (d) => d.id === "rec-002",
)!;
const uploadedDetail = MOCK_RECORDING_DETAILS.find(
  (d) => d.id === "rec-003",
)!;
const failedDetail = MOCK_RECORDING_DETAILS.find(
  (d) => d.id === "rec-005",
)!;

// ── formatTimestamp ──

describe("formatTimestamp", () => {
  test("formats 0 ms", () => {
    expect(formatTimestamp(0)).toBe("0:00.0");
  });

  test("formats seconds", () => {
    expect(formatTimestamp(3200)).toBe("0:03.2");
  });

  test("formats minutes and seconds", () => {
    expect(formatTimestamp(72500)).toBe("1:12.5");
  });

  test("formats large values", () => {
    expect(formatTimestamp(600000)).toBe("10:00.0");
  });
});

// ── countWords ──

describe("countWords", () => {
  test("counts english words", () => {
    expect(countWords("hello world")).toBe(2);
  });

  test("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  test("returns 0 for whitespace only", () => {
    expect(countWords("   ")).toBe(0);
  });

  test("handles multiple spaces", () => {
    expect(countWords("one   two   three")).toBe(3);
  });

  test("counts words in a sentence", () => {
    expect(
      countWords("Welcome to the quarterly product review meeting."),
    ).toBe(7);
  });
});

// ── toSentenceVM ──

describe("toSentenceVM", () => {
  const sentence: TranscriptionSentence = {
    sentenceId: 0,
    beginTime: 0,
    endTime: 3200,
    text: "Hello world.",
    language: "en",
    emotion: "neutral",
  };

  test("maps id and text", () => {
    const vm = toSentenceVM(sentence);
    expect(vm.id).toBe(0);
    expect(vm.text).toBe("Hello world.");
  });

  test("formats timestamps", () => {
    const vm = toSentenceVM(sentence);
    expect(vm.startTime).toBe("0:00.0");
    expect(vm.endTime).toBe("0:03.2");
  });

  test("computes duration", () => {
    const vm = toSentenceVM(sentence);
    expect(vm.duration).toBe("3.2s");
  });

  test("maps language and emotion", () => {
    const vm = toSentenceVM(sentence);
    expect(vm.language).toBe("en");
    expect(vm.emotion).toBe("neutral");
  });

  test("includes raw millisecond times", () => {
    const vm = toSentenceVM(sentence);
    expect(vm.beginTimeMs).toBe(0);
    expect(vm.endTimeMs).toBe(3200);
  });
});

// ── toRecordingMetadataVM ──

describe("toRecordingMetadataVM", () => {
  test("maps basic fields", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.id).toBe("rec-001");
    expect(vm.title).toBe("Q4 Product Review Meeting");
    expect(vm.fileName).toBe("q4-product-review.mp3");
  });

  test("formats file size", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.fileSize).toBe("15.0 MB");
  });

  test("formats duration", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.duration).toBe("30:47"); // 1847.5s
  });

  test("formats sample rate", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.sampleRate).toBe("48000 Hz");
  });

  test("handles null sample rate", () => {
    const noSr: RecordingDetail = {
      ...completedDetail,
      sampleRate: null,
    };
    expect(toRecordingMetadataVM(noSr).sampleRate).toBe("—");
  });

  test("canTranscribe is true for uploaded", () => {
    expect(toRecordingMetadataVM(uploadedDetail).canTranscribe).toBe(true);
  });

  test("canTranscribe is false for completed", () => {
    expect(toRecordingMetadataVM(completedDetail).canTranscribe).toBe(false);
  });

  test("canRetranscribe is true for completed", () => {
    expect(toRecordingMetadataVM(completedDetail).canRetranscribe).toBe(true);
  });

  test("canRetranscribe is true for failed", () => {
    expect(toRecordingMetadataVM(failedDetail).canRetranscribe).toBe(true);
  });

  test("canRetranscribe is false for uploaded", () => {
    expect(toRecordingMetadataVM(uploadedDetail).canRetranscribe).toBe(false);
  });
});

// ── toTranscriptionVM ──

describe("toTranscriptionVM", () => {
  test("returns null when no transcription", () => {
    expect(toTranscriptionVM(uploadedDetail)).toBeNull();
  });

  test("maps full text", () => {
    const vm = toTranscriptionVM(completedDetail);
    expect(vm).not.toBeNull();
    expect(vm!.fullText).toContain("Welcome to the quarterly");
  });

  test("maps sentences", () => {
    const vm = toTranscriptionVM(completedDetail);
    expect(vm!.sentenceCount).toBe(5);
    expect(vm!.sentences[0]!.text).toContain("Welcome");
  });

  test("computes word count", () => {
    const vm = toTranscriptionVM(completedDetail);
    expect(vm!.wordCount).toBeGreaterThan(0);
  });

  test("maps language", () => {
    const vm = toTranscriptionVM(completedDetail);
    expect(vm!.language).toBe("en");
  });
});

// ── computeProcessingDuration ──

describe("computeProcessingDuration", () => {
  test("returns dash for null submit time", () => {
    expect(computeProcessingDuration(null, "2025-01-01 00:00:00")).toBe("—");
  });

  test("returns dash for null end time", () => {
    expect(computeProcessingDuration("2025-01-01 00:00:00", null)).toBe("—");
  });

  test("computes duration between times", () => {
    const result = computeProcessingDuration(
      "2025-02-12 10:00:00.000",
      "2025-02-12 10:02:35.000",
    );
    expect(result).toBe("2:35");
  });

  test("handles same time", () => {
    const result = computeProcessingDuration(
      "2025-01-01 00:00:00",
      "2025-01-01 00:00:00",
    );
    expect(result).toBe("—"); // 0 seconds → dash
  });
});

// ── toJobStatusVM ──

describe("toJobStatusVM", () => {
  test("returns null for null job", () => {
    expect(toJobStatusVM(null)).toBeNull();
  });

  test("maps succeeded job", () => {
    const vm = toJobStatusVM(completedDetail.latestJob);
    expect(vm).not.toBeNull();
    expect(vm!.status).toBe("SUCCEEDED");
    expect(vm!.isCompleted).toBe(true);
    expect(vm!.isRunning).toBe(false);
    expect(vm!.isFailed).toBe(false);
  });

  test("maps running job", () => {
    const vm = toJobStatusVM(transcribingDetail.latestJob);
    expect(vm!.isRunning).toBe(true);
    expect(vm!.isCompleted).toBe(false);
  });

  test("maps failed job", () => {
    const vm = toJobStatusVM(failedDetail.latestJob);
    expect(vm!.isFailed).toBe(true);
    expect(vm!.errorMessage).toContain("not supported");
  });

  test("formats usage seconds", () => {
    const vm = toJobStatusVM(completedDetail.latestJob);
    expect(vm!.usageSeconds).toBe("30:48"); // 1848s
  });
});

// ── toRecordingDetailVM ──

describe("toRecordingDetailVM", () => {
  test("combines metadata and transcription for completed", () => {
    const vm = toRecordingDetailVM(completedDetail);
    expect(vm.metadata.title).toBe("Q4 Product Review Meeting");
    expect(vm.hasTranscription).toBe(true);
    expect(vm.isTranscribing).toBe(false);
    expect(vm.transcription).not.toBeNull();
    expect(vm.job).not.toBeNull();
  });

  test("has no transcription for uploaded", () => {
    const vm = toRecordingDetailVM(uploadedDetail);
    expect(vm.hasTranscription).toBe(false);
    expect(vm.transcription).toBeNull();
    expect(vm.job).toBeNull();
  });

  test("shows transcribing state", () => {
    const vm = toRecordingDetailVM(transcribingDetail);
    expect(vm.isTranscribing).toBe(true);
    expect(vm.hasTranscription).toBe(false);
  });

  test("shows failed state", () => {
    const vm = toRecordingDetailVM(failedDetail);
    expect(vm.isTranscribing).toBe(false);
    expect(vm.hasTranscription).toBe(false);
    expect(vm.job!.isFailed).toBe(true);
  });
});

// ── findActiveSentenceIndex ──

describe("findActiveSentenceIndex", () => {
  // Create test sentences: [0-3200ms], [3200-7800ms], [7800-12400ms]
  const sentences = [
    { sentenceId: 0, beginTime: 0, endTime: 3200, text: "First", language: "en", emotion: "neutral" },
    { sentenceId: 1, beginTime: 3200, endTime: 7800, text: "Second", language: "en", emotion: "neutral" },
    { sentenceId: 2, beginTime: 7800, endTime: 12400, text: "Third", language: "en", emotion: "neutral" },
  ].map(toSentenceVM);

  test("returns 0 for time at start of first sentence", () => {
    expect(findActiveSentenceIndex(sentences, 0)).toBe(0);
  });

  test("returns 0 for time within first sentence", () => {
    expect(findActiveSentenceIndex(sentences, 1.5)).toBe(0);
  });

  test("returns 1 for time at start of second sentence", () => {
    expect(findActiveSentenceIndex(sentences, 3.2)).toBe(1);
  });

  test("returns 1 for time within second sentence", () => {
    expect(findActiveSentenceIndex(sentences, 5.0)).toBe(1);
  });

  test("returns 2 for time within third sentence", () => {
    expect(findActiveSentenceIndex(sentences, 10.0)).toBe(2);
  });

  test("returns -1 for time after all sentences", () => {
    expect(findActiveSentenceIndex(sentences, 13.0)).toBe(-1);
  });

  test("returns -1 for empty sentences array", () => {
    expect(findActiveSentenceIndex([], 5.0)).toBe(-1);
  });

  test("returns -1 for negative time", () => {
    // -1 seconds = -1000ms, no sentence covers that
    expect(findActiveSentenceIndex(sentences, -1)).toBe(-1);
  });

  test("handles boundary: endTime is exclusive", () => {
    // At exactly 3.2s (3200ms), first sentence [0,3200) is done, second [3200,7800) starts
    expect(findActiveSentenceIndex(sentences, 3.2)).toBe(1);
  });
});
