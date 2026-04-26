import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { recordingsRepo } from "@lyre/api/db/repositories/recordings";
import { jobsRepo } from "@lyre/api/db/repositories/jobs";
import { transcriptionsRepo } from "@lyre/api/db/repositories/transcriptions";
import type { TranscriptionSentence } from "@lyre/api/lib/types";

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

async function seedJobAndRecording() {
  await usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
  await recordingsRepo.create({
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
    status: "completed",
  });
  await jobsRepo.create({
    id: "job-1",
    recordingId: "rec-1",
    taskId: "task-1",
    requestId: null,
    status: "SUCCEEDED",
  });
}

async function makeTranscription(
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
  beforeEach(async () => {
    resetDb();
    await seedJobAndRecording();
  });

  describe("create", () => {
    test("creates a transcription and returns it", async () => {
      const t = await transcriptionsRepo.create(await makeTranscription());
      expect(t.id).toBe("trans-1");
      expect(t.fullText).toBe("Hello world. This is a test.");
      expect(t.language).toBe("en");
      expect(t.createdAt).toBeGreaterThan(0);
    });

    test("serializes sentences as JSON", async () => {
      const t = await transcriptionsRepo.create(await makeTranscription());
      expect(typeof t.sentences).toBe("string");
      const parsed = JSON.parse(t.sentences) as TranscriptionSentence[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.text).toBe("Hello world");
    });

    test("allows null language", async () => {
      const t = await transcriptionsRepo.create(
        await makeTranscription({ language: null }),
      );
      expect(t.language).toBeNull();
    });

    test("handles empty sentences array", async () => {
      const t = await transcriptionsRepo.create(
        await makeTranscription({ sentences: [] }),
      );
      expect(t.sentences).toBe("[]");
    });
  });

  describe("findById", () => {
    test("returns transcription when found", async () => {
      await transcriptionsRepo.create(await makeTranscription());
      const found = await transcriptionsRepo.findById("trans-1");
      expect(found?.fullText).toBe("Hello world. This is a test.");
    });

    test("returns undefined when not found", async () => {
      expect(await transcriptionsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByRecordingId", () => {
    test("returns transcription for recording", async () => {
      await transcriptionsRepo.create(await makeTranscription());
      const found = await transcriptionsRepo.findByRecordingId("rec-1");
      expect(found?.id).toBe("trans-1");
    });

    test("returns undefined when not found", async () => {
      expect(await transcriptionsRepo.findByRecordingId("nope")).toBeUndefined();
    });
  });

  describe("update", () => {
    test("updates fullText", async () => {
      await transcriptionsRepo.create(await makeTranscription());
      const updated = await transcriptionsRepo.update("trans-1", {
        fullText: "Updated text",
      });
      expect(updated?.fullText).toBe("Updated text");
    });

    test("updates sentences (serialized)", async () => {
      await transcriptionsRepo.create(await makeTranscription());
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
      const updated = await transcriptionsRepo.update("trans-1", {
        sentences: newSentences,
      });
      const parsed = JSON.parse(
        updated!.sentences,
      ) as TranscriptionSentence[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.text).toBe("New sentence");
    });

    test("updates language", async () => {
      await transcriptionsRepo.create(await makeTranscription());
      const updated = await transcriptionsRepo.update("trans-1", {
        language: "zh",
      });
      expect(updated?.language).toBe("zh");
    });

    test("updates updatedAt", async () => {
      const t = await transcriptionsRepo.create(await makeTranscription());
      const updated = await transcriptionsRepo.update("trans-1", {
        fullText: "X",
      });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.updatedAt);
    });

    test("returns undefined when not found", async () => {
      expect(
        await transcriptionsRepo.update("nope", { fullText: "X" }),
      ).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing transcription", async () => {
      await transcriptionsRepo.create(await makeTranscription());
      expect(await transcriptionsRepo.delete("trans-1")).toBe(true);
      expect(await transcriptionsRepo.findById("trans-1")).toBeUndefined();
    });

    test("returns false when not found", async () => {
      expect(await transcriptionsRepo.delete("nope")).toBe(false);
    });
  });

  describe("deleteByRecordingId", () => {
    test("deletes transcription for recording", async () => {
      await transcriptionsRepo.create(await makeTranscription());
      expect(await transcriptionsRepo.deleteByRecordingId("rec-1")).toBe(true);
      expect(await transcriptionsRepo.findByRecordingId("rec-1")).toBeUndefined();
    });

    test("returns false when no transcription for recording", async () => {
      expect(await transcriptionsRepo.deleteByRecordingId("nope")).toBe(false);
    });
  });

  describe("parseSentences", () => {
    test("parses valid JSON array", async () => {
      const result = await transcriptionsRepo.parseSentences(JSON.stringify(SENTENCES));
      expect(result).toHaveLength(2);
      expect(result[0]?.beginTime).toBe(0);
      expect(result[1]?.text).toBe("This is a test");
    });

    test("returns empty array for empty JSON", async () => {
      expect(await transcriptionsRepo.parseSentences("[]")).toEqual([]);
    });

    test("returns empty array for invalid JSON", async () => {
      expect(await transcriptionsRepo.parseSentences("not json")).toEqual([]);
    });

    test("returns empty array for non-array JSON", async () => {
      expect(await transcriptionsRepo.parseSentences('{"a":1}')).toEqual([]);
    });
  });
});
