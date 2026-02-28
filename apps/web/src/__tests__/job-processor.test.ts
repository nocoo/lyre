import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { recordingsRepo } from "@/db/repositories/recordings";
import { jobsRepo } from "@/db/repositories/jobs";
import { transcriptionsRepo } from "@/db/repositories/transcriptions";
import { pollJob } from "@/services/job-processor";
import type { AsrProvider, AsrPollResponse, AsrTranscriptionResult } from "@/services/asr";

// ── Test helpers ──

function seedUser() {
  usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

function seedRecording(overrides?: Partial<Parameters<typeof recordingsRepo.create>[0]>) {
  return recordingsRepo.create({
    id: "rec-1",
    userId: "user-1",
    title: "Test Recording",
    description: null,
    fileName: "test.mp3",
    fileSize: 1024,
    duration: 60,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "uploads/test.mp3",
    tags: [],
    status: "transcribing",
    ...overrides,
  });
}

function seedJob(overrides?: Partial<Parameters<typeof jobsRepo.create>[0]>) {
  return jobsRepo.create({
    id: "job-1",
    recordingId: "rec-1",
    taskId: "task-abc-123",
    requestId: "req-xyz",
    status: "PENDING",
    ...overrides,
  });
}

const MOCK_RAW_RESULT: AsrTranscriptionResult = {
  file_url: "https://oss.example.com/test.mp3",
  audio_info: { format: "mp3", sample_rate: 48000 },
  transcripts: [
    {
      channel_id: 0,
      text: "Hello world.",
      sentences: [
        {
          sentence_id: 0,
          begin_time: 0,
          end_time: 2000,
          language: "en",
          emotion: "neutral",
          text: "Hello world.",
          words: [
            { begin_time: 0, end_time: 500, text: "Hello", punctuation: "" },
            { begin_time: 600, end_time: 2000, text: "world", punctuation: "." },
          ],
        },
      ],
    },
  ],
};

function makePollResponse(
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED",
  overrides?: Partial<AsrPollResponse>,
): AsrPollResponse {
  const base: AsrPollResponse = {
    request_id: "req-poll-1",
    output: {
      task_id: "task-abc-123",
      task_status: status,
    },
    ...(status === "SUCCEEDED"
      ? {
          usage: { seconds: 60 },
        }
      : {}),
  };

  if (status === "SUCCEEDED") {
    base.output.result = { transcription_url: "https://oss.example.com/result.json" };
    base.output.submit_time = "2026-01-15T10:00:00Z";
    base.output.end_time = "2026-01-15T10:01:00Z";
  }

  if (status === "FAILED") {
    base.output.message = "Audio too short";
  }

  return { ...base, ...overrides };
}

function makeProvider(overrides?: Partial<AsrProvider>): AsrProvider {
  return {
    submit: async () => ({
      request_id: "req-1",
      output: { task_id: "task-abc-123", task_status: "PENDING" as const },
    }),
    poll: async () => makePollResponse("PENDING"),
    fetchResult: async () => MOCK_RAW_RESULT,
    ...overrides,
  };
}

// ── Tests ──

describe("job-processor", () => {
  beforeEach(() => {
    resetDb();
    seedUser();
    seedRecording();
  });

  describe("pollJob — terminal jobs", () => {
    test("returns immediately for SUCCEEDED job without polling", async () => {
      const job = seedJob({ status: "SUCCEEDED" });
      let pollCalled = false;
      const provider = makeProvider({
        poll: async () => {
          pollCalled = true;
          return makePollResponse("SUCCEEDED");
        },
      });

      const result = await pollJob(job, provider);

      expect(pollCalled).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.previousStatus).toBeNull();
      expect(result.job.status).toBe("SUCCEEDED");
    });

    test("returns immediately for FAILED job without polling", async () => {
      const job = seedJob({ status: "FAILED" });
      const provider = makeProvider();

      const result = await pollJob(job, provider);

      expect(result.changed).toBe(false);
      expect(result.job.status).toBe("FAILED");
    });
  });

  describe("pollJob — status transitions", () => {
    test("PENDING → RUNNING: updates job, reports change", async () => {
      const job = seedJob({ status: "PENDING" });
      const provider = makeProvider({
        poll: async () => makePollResponse("RUNNING"),
      });

      const result = await pollJob(job, provider);

      expect(result.changed).toBe(true);
      expect(result.previousStatus).toBe("PENDING");
      expect(result.job.status).toBe("RUNNING");

      // DB should be updated
      const dbJob = jobsRepo.findById("job-1");
      expect(dbJob?.status).toBe("RUNNING");
    });

    test("PENDING → PENDING: updates job, reports no change", async () => {
      const job = seedJob({ status: "PENDING" });
      const provider = makeProvider({
        poll: async () => makePollResponse("PENDING"),
      });

      const result = await pollJob(job, provider);

      expect(result.changed).toBe(false);
      expect(result.previousStatus).toBe("PENDING");
      expect(result.job.status).toBe("PENDING");
    });

    test("RUNNING → SUCCEEDED: saves transcription, updates recording", async () => {
      const job = seedJob({ status: "RUNNING" });
      const provider = makeProvider({
        poll: async () => makePollResponse("SUCCEEDED"),
        fetchResult: async () => MOCK_RAW_RESULT,
      });

      const result = await pollJob(job, provider);

      expect(result.changed).toBe(true);
      expect(result.previousStatus).toBe("RUNNING");
      expect(result.job.status).toBe("SUCCEEDED");

      // Transcription should be saved
      const transcription = transcriptionsRepo.findByRecordingId("rec-1");
      expect(transcription).toBeDefined();
      expect(transcription?.fullText).toBe("Hello world.");
      expect(transcription?.jobId).toBe("job-1");

      // Recording status should be "completed"
      const recording = recordingsRepo.findById("rec-1");
      expect(recording?.status).toBe("completed");

      // Job should have usage and timing data
      const dbJob = jobsRepo.findById("job-1");
      expect(dbJob?.usageSeconds).toBe(60);
      expect(dbJob?.resultUrl).toBe("https://oss.example.com/result.json");
    });

    test("RUNNING → FAILED: records error, updates recording", async () => {
      const job = seedJob({ status: "RUNNING" });
      const provider = makeProvider({
        poll: async () => makePollResponse("FAILED"),
      });

      const result = await pollJob(job, provider);

      expect(result.changed).toBe(true);
      expect(result.previousStatus).toBe("RUNNING");
      expect(result.job.status).toBe("FAILED");

      // Error message should be saved
      const dbJob = jobsRepo.findById("job-1");
      expect(dbJob?.errorMessage).toBe("Audio too short");

      // Recording status should be "failed"
      const recording = recordingsRepo.findById("rec-1");
      expect(recording?.status).toBe("failed");
    });
  });

  describe("pollJob — result processing failure", () => {
    test("marks job as FAILED when fetchResult throws", async () => {
      const job = seedJob({ status: "RUNNING" });
      const provider = makeProvider({
        poll: async () => makePollResponse("SUCCEEDED"),
        fetchResult: async () => {
          throw new Error("Network timeout");
        },
      });

      const result = await pollJob(job, provider);

      expect(result.job.status).toBe("FAILED");
      expect(result.job.errorMessage).toContain("Result processing failed");
      expect(result.job.errorMessage).toContain("Network timeout");

      const recording = recordingsRepo.findById("rec-1");
      expect(recording?.status).toBe("failed");
    });
  });

  describe("pollJob — re-transcription", () => {
    test("deletes existing transcription before saving new one", async () => {
      // Seed an old job + transcription
      const oldJob = seedJob({ id: "job-old", taskId: "task-old", status: "SUCCEEDED" });
      transcriptionsRepo.create({
        id: "tx-old",
        recordingId: "rec-1",
        jobId: oldJob.id,
        fullText: "Old text",
        sentences: [],
        language: "en",
      });

      const job = seedJob({ id: "job-1", taskId: "task-abc-123", status: "RUNNING" });
      const provider = makeProvider({
        poll: async () => makePollResponse("SUCCEEDED"),
        fetchResult: async () => MOCK_RAW_RESULT,
      });

      await pollJob(job, provider);

      const transcription = transcriptionsRepo.findByRecordingId("rec-1");
      expect(transcription).toBeDefined();
      expect(transcription?.fullText).toBe("Hello world.");
      expect(transcription?.id).not.toBe("tx-old");
    });
  });

  describe("pollJob — provider error propagation", () => {
    test("throws when provider.poll throws", async () => {
      const job = seedJob({ status: "PENDING" });
      const provider = makeProvider({
        poll: async () => {
          throw new Error("DashScope unreachable");
        },
      });

      await expect(pollJob(job, provider)).rejects.toThrow("DashScope unreachable");

      // Job should NOT be modified on provider errors
      const dbJob = jobsRepo.findById("job-1");
      expect(dbJob?.status).toBe("PENDING");
    });
  });
});
