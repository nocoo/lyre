import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { recordingsRepo } from "@/db/repositories/recordings";
import { jobsRepo } from "@/db/repositories/jobs";
import { transcriptionsRepo } from "@/db/repositories/transcriptions";
import type { TranscriptionSentence } from "@/lib/types";

const SENTENCES: TranscriptionSentence[] = [
  {
    sentenceId: 0,
    beginTime: 0,
    endTime: 3500,
    text: "Hello world",
    language: "en",
    emotion: "neutral",
  },
  {
    sentenceId: 1,
    beginTime: 3500,
    endTime: 7000,
    text: "This is a test",
    language: "en",
    emotion: "happy",
  },
];

function seedJobAndRecording() {
  usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
  recordingsRepo.create({
    id: "rec-1",
    userId: "user-1",
    title: "Test",
    description: null,
    fileName: "test.mp3",
    fileSize: 1024,
    duration: 60,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "uploads/test.mp3",
    tags: [],
    status: "completed",
  });
  jobsRepo.create({
    id: "job-1",
    recordingId: "rec-1",
    taskId: "task-1",
    requestId: null,
    status: "SUCCEEDED",
  });
}

function makeTranscription(
  overrides?: Partial<Parameters<typeof transcriptionsRepo.create>[0]>,
) {
  return {
    id: "trans-1",
    recordingId: "rec-1",
    jobId: "job-1",
    fullText: "Hello world. This is a test.",
    sentences: SENTENCES,
    language: "en",
    ...overrides,
  };
}

describe("transcriptionsRepo", () => {
  beforeEach(() => {
    resetDb();
    seedJobAndRecording();
  });

  describe("create", () => {
    test("creates a transcription and returns it", () => {
      const t = transcriptionsRepo.create(makeTranscription());
      expect(t.id).toBe("trans-1");
      expect(t.fullText).toBe("Hello world. This is a test.");
      expect(t.language).toBe("en");
      expect(t.createdAt).toBeGreaterThan(0);
    });

    test("serializes sentences as JSON", () => {
      const t = transcriptionsRepo.create(makeTranscription());
      expect(typeof t.sentences).toBe("string");
      const parsed = JSON.parse(t.sentences) as TranscriptionSentence[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.text).toBe("Hello world");
    });

    test("allows null language", () => {
      const t = transcriptionsRepo.create(
        makeTranscription({ language: null }),
      );
      expect(t.language).toBeNull();
    });

    test("handles empty sentences array", () => {
      const t = transcriptionsRepo.create(
        makeTranscription({ sentences: [] }),
      );
      expect(t.sentences).toBe("[]");
    });
  });

  describe("findById", () => {
    test("returns transcription when found", () => {
      transcriptionsRepo.create(makeTranscription());
      const found = transcriptionsRepo.findById("trans-1");
      expect(found?.fullText).toBe("Hello world. This is a test.");
    });

    test("returns undefined when not found", () => {
      expect(transcriptionsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByRecordingId", () => {
    test("returns transcription for recording", () => {
      transcriptionsRepo.create(makeTranscription());
      const found = transcriptionsRepo.findByRecordingId("rec-1");
      expect(found?.id).toBe("trans-1");
    });

    test("returns undefined when not found", () => {
      expect(transcriptionsRepo.findByRecordingId("nope")).toBeUndefined();
    });
  });

  describe("update", () => {
    test("updates fullText", () => {
      transcriptionsRepo.create(makeTranscription());
      const updated = transcriptionsRepo.update("trans-1", {
        fullText: "Updated text",
      });
      expect(updated?.fullText).toBe("Updated text");
    });

    test("updates sentences (serialized)", () => {
      transcriptionsRepo.create(makeTranscription());
      const newSentences: TranscriptionSentence[] = [
        {
          sentenceId: 0,
          beginTime: 0,
          endTime: 5000,
          text: "New sentence",
          language: "en",
          emotion: "neutral",
        },
      ];
      const updated = transcriptionsRepo.update("trans-1", {
        sentences: newSentences,
      });
      const parsed = JSON.parse(
        updated!.sentences,
      ) as TranscriptionSentence[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.text).toBe("New sentence");
    });

    test("updates language", () => {
      transcriptionsRepo.create(makeTranscription());
      const updated = transcriptionsRepo.update("trans-1", {
        language: "zh",
      });
      expect(updated?.language).toBe("zh");
    });

    test("updates updatedAt", () => {
      const t = transcriptionsRepo.create(makeTranscription());
      const updated = transcriptionsRepo.update("trans-1", {
        fullText: "X",
      });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.updatedAt);
    });

    test("returns undefined when not found", () => {
      expect(
        transcriptionsRepo.update("nope", { fullText: "X" }),
      ).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing transcription", () => {
      transcriptionsRepo.create(makeTranscription());
      expect(transcriptionsRepo.delete("trans-1")).toBe(true);
      expect(transcriptionsRepo.findById("trans-1")).toBeUndefined();
    });

    test("returns false when not found", () => {
      expect(transcriptionsRepo.delete("nope")).toBe(false);
    });
  });

  describe("deleteByRecordingId", () => {
    test("deletes transcription for recording", () => {
      transcriptionsRepo.create(makeTranscription());
      expect(transcriptionsRepo.deleteByRecordingId("rec-1")).toBe(true);
      expect(transcriptionsRepo.findByRecordingId("rec-1")).toBeUndefined();
    });

    test("returns false when no transcription for recording", () => {
      expect(transcriptionsRepo.deleteByRecordingId("nope")).toBe(false);
    });
  });

  describe("parseSentences", () => {
    test("parses valid JSON array", () => {
      const result = transcriptionsRepo.parseSentences(JSON.stringify(SENTENCES));
      expect(result).toHaveLength(2);
      expect(result[0]?.beginTime).toBe(0);
      expect(result[1]?.text).toBe("This is a test");
    });

    test("returns empty array for empty JSON", () => {
      expect(transcriptionsRepo.parseSentences("[]")).toEqual([]);
    });

    test("returns empty array for invalid JSON", () => {
      expect(transcriptionsRepo.parseSentences("not json")).toEqual([]);
    });

    test("returns empty array for non-array JSON", () => {
      expect(transcriptionsRepo.parseSentences('{"a":1}')).toEqual([]);
    });
  });
});
