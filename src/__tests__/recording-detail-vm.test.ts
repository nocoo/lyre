import { describe, expect, test } from "bun:test";
import {
  toRecordingMetadataVM,
  toTranscriptionVM,
  toJobStatusVM,
  toRecordingDetailVM,
  formatTimestamp,
  countWords,
  computeProcessingDuration,
  computeEstimatedCost,
  toSentenceVM,
  findActiveSentenceIndex,
  toWordVM,
  findActiveWordIndex,
  ASR_MODEL,
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

  test("maps resolvedTags from detail", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.resolvedTags.length).toBeGreaterThan(0);
    expect(vm.resolvedTags[0]!.name).toBe("meeting");
  });

  test("maps notes from detail", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.notes).toContain("23% MAU growth");
  });

  test("maps empty notes for null", () => {
    const vm = toRecordingMetadataVM(uploadedDetail);
    expect(vm.notes).toBe("");
  });

  test("maps folderName and folderIcon", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.folderName).toBe("Meetings");
    expect(vm.folderIcon).toBe("users");
  });

  test("maps empty folder fields when no folder", () => {
    const vm = toRecordingMetadataVM(uploadedDetail);
    expect(vm.folderName).toBe("");
    expect(vm.folderIcon).toBe("");
  });

  test("maps recordedAt date string", () => {
    const vm = toRecordingMetadataVM(completedDetail);
    expect(vm.recordedAt).not.toBe("");
    expect(vm.recordedAtRaw).toBe(completedDetail.recordedAt);
  });

  test("maps empty recordedAt when null", () => {
    const noDate: RecordingDetail = {
      ...completedDetail,
      recordedAt: null,
    };
    const vm = toRecordingMetadataVM(noDate);
    expect(vm.recordedAt).toBe("");
    expect(vm.recordedAtRaw).toBeNull();
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

  test("returns dash for invalid date strings", () => {
    expect(computeProcessingDuration("not-a-date", "also-not-a-date")).toBe("—");
  });

  test("returns dash when only submit time is invalid", () => {
    expect(computeProcessingDuration("invalid", "2025-01-01 00:00:00")).toBe("—");
  });

  test("returns dash when only end time is invalid", () => {
    expect(computeProcessingDuration("2025-01-01 00:00:00", "invalid")).toBe("—");
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

// ── computeEstimatedCost ──

describe("computeEstimatedCost", () => {
  test("returns dash for null usage", () => {
    expect(computeEstimatedCost(null)).toBe("—");
  });

  test("returns dash for zero usage", () => {
    expect(computeEstimatedCost(0)).toBe("—");
  });

  test("returns dash for negative usage", () => {
    expect(computeEstimatedCost(-10)).toBe("—");
  });

  test("computes cost for small usage (< ¥0.01)", () => {
    // 10 seconds × ¥0.00022 = ¥0.0022
    expect(computeEstimatedCost(10)).toBe("¥0.0022");
  });

  test("computes cost for typical usage", () => {
    // 1848 seconds × ¥0.00022 = ¥0.4065... → ¥0.41
    expect(computeEstimatedCost(1848)).toBe("¥0.41");
  });

  test("computes cost for 1 hour", () => {
    // 3600 seconds × ¥0.00022 = ¥0.792 → ¥0.79
    expect(computeEstimatedCost(3600)).toBe("¥0.79");
  });

  test("computes cost for large usage", () => {
    // 36000 seconds (10h) × ¥0.00022 = ¥7.92
    expect(computeEstimatedCost(36000)).toBe("¥7.92");
  });
});

// ── toJobStatusVM includes model and cost ──

describe("toJobStatusVM model and cost", () => {
  test("includes model name for succeeded job", () => {
    const vm = toJobStatusVM(completedDetail.latestJob);
    expect(vm!.model).toBe(ASR_MODEL);
  });

  test("includes estimated cost for succeeded job with usage", () => {
    const vm = toJobStatusVM(completedDetail.latestJob);
    // completedDetail has usageSeconds = 1848 → ¥0.41
    expect(vm!.estimatedCost).toBe("¥0.41");
  });

  test("returns dash for cost when no usage", () => {
    const vm = toJobStatusVM(transcribingDetail.latestJob);
    expect(vm!.estimatedCost).toBe("—");
  });
});

// ── toWordVM ──

describe("toWordVM", () => {
  test("maps raw word to WordVM", () => {
    const vm = toWordVM({
      begin_time: 876,
      end_time: 956,
      text: "阿",
      punctuation: "",
    });
    expect(vm.text).toBe("阿");
    expect(vm.punctuation).toBe("");
    expect(vm.display).toBe("阿");
    expect(vm.beginTimeMs).toBe(876);
    expect(vm.endTimeMs).toBe(956);
  });

  test("includes punctuation in display", () => {
    const vm = toWordVM({
      begin_time: 1276,
      end_time: 1356,
      text: "好",
      punctuation: "，",
    });
    expect(vm.display).toBe("好，");
  });

  test("handles English word with period", () => {
    const vm = toWordVM({
      begin_time: 3800,
      end_time: 5000,
      text: "transcription",
      punctuation: ".",
    });
    expect(vm.display).toBe("transcription.");
  });
});

// ── findActiveWordIndex ──

describe("findActiveWordIndex", () => {
  // "阿姨好，阿姨好。" — 6 words with real timing data
  const words = [
    { begin_time: 876, end_time: 956, text: "阿", punctuation: "" },
    { begin_time: 956, end_time: 1196, text: "姨", punctuation: "" },
    { begin_time: 1276, end_time: 1356, text: "好", punctuation: "，" },
    { begin_time: 2076, end_time: 2156, text: "阿", punctuation: "" },
    { begin_time: 2956, end_time: 2956, text: "姨", punctuation: "" },   // instantaneous
    { begin_time: 3276, end_time: 3436, text: "好", punctuation: "。" },
  ].map(toWordVM);

  test("returns 0 for time within first word", () => {
    expect(findActiveWordIndex(words, 0.9)).toBe(0); // 900ms
  });

  test("returns 1 for time within second word", () => {
    expect(findActiveWordIndex(words, 1.0)).toBe(1); // 1000ms
  });

  test("returns 2 for time within third word", () => {
    expect(findActiveWordIndex(words, 1.3)).toBe(2); // 1300ms
  });

  test("returns -1 for time in gap between words", () => {
    expect(findActiveWordIndex(words, 1.4)).toBe(-1); // 1400ms — gap between word 2 end (1356) and word 3 start (2076)
  });

  test("returns 3 for time within fourth word", () => {
    expect(findActiveWordIndex(words, 2.1)).toBe(3); // 2100ms
  });

  test("handles instantaneous word (begin_time === end_time)", () => {
    expect(findActiveWordIndex(words, 2.96)).toBe(4); // 2960ms — at the instantaneous word
  });

  test("returns 5 for time within last word", () => {
    expect(findActiveWordIndex(words, 3.3)).toBe(5); // 3300ms
  });

  test("returns -1 for time after all words", () => {
    expect(findActiveWordIndex(words, 4.0)).toBe(-1); // 4000ms
  });

  test("returns -1 for time before all words", () => {
    expect(findActiveWordIndex(words, 0.5)).toBe(-1); // 500ms — before first word starts at 876
  });

  test("returns -1 for empty words array", () => {
    expect(findActiveWordIndex([], 1.0)).toBe(-1);
  });
});
