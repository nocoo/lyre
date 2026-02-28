import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { recordingsRepo } from "@/db/repositories/recordings";
import { jobsRepo } from "@/db/repositories/jobs";
import { JobManager, type JobEvent, type JobManagerDeps } from "@/services/job-manager";
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

function seedRecording(id = "rec-1", status: "uploaded" | "transcribing" = "transcribing") {
  return recordingsRepo.create({
    id,
    userId: "user-1",
    title: "Test Recording",
    description: null,
    fileName: "test.mp3",
    fileSize: 1024,
    duration: 60,
    format: "mp3",
    sampleRate: 44100,
    ossKey: `uploads/${id}.mp3`,
    tags: [],
    status,
  });
}

function seedJob(
  id = "job-1",
  recordingId = "rec-1",
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" = "PENDING",
) {
  return jobsRepo.create({
    id,
    recordingId,
    taskId: `task-${id}`,
    requestId: `req-${id}`,
    status,
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
): AsrPollResponse {
  const base: AsrPollResponse = {
    request_id: "req-poll",
    output: {
      task_id: "task-job-1",
      task_status: status,
    },
  };

  if (status === "SUCCEEDED") {
    base.output.result = { transcription_url: "https://oss.example.com/result.json" };
    base.output.submit_time = "2026-01-15T10:00:00Z";
    base.output.end_time = "2026-01-15T10:01:00Z";
    base.usage = { seconds: 60 };
  }

  if (status === "FAILED") {
    base.output.message = "Audio too short";
  }

  return base;
}

function makeProvider(pollFn?: AsrProvider["poll"]): AsrProvider {
  return {
    submit: async () => ({
      request_id: "req-1",
      output: { task_id: "task-1", task_status: "PENDING" as const },
    }),
    poll: pollFn ?? (async () => makePollResponse("PENDING")),
    fetchResult: async () => MOCK_RAW_RESULT,
  };
}

function makeDeps(overrides?: Partial<JobManagerDeps>): JobManagerDeps {
  return {
    getProvider: () => makeProvider(),
    findActiveJobs: () => jobsRepo.findActive(),
    findJobById: (id) => jobsRepo.findById(id),
    pollIntervalMs: 50, // Fast for tests
    ...overrides,
  };
}

/** Wait for condition or timeout. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Tests ──

describe("JobManager", () => {
  let manager: JobManager;

  beforeEach(() => {
    resetDb();
    seedUser();
  });

  afterEach(() => {
    manager?.stop();
  });

  describe("track + polling", () => {
    test("tracks a job and starts polling", async () => {
      seedRecording();
      const job = seedJob();

      let pollCount = 0;
      const provider = makeProvider(async () => {
        pollCount++;
        return makePollResponse("RUNNING");
      });

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      manager.track(job);

      expect(manager.activeCount).toBe(1);
      expect(manager.isTracking("job-1")).toBe(true);

      // Wait for at least one poll
      await waitFor(() => pollCount > 0);
      expect(pollCount).toBeGreaterThanOrEqual(1);
    });

    test("does not track terminal jobs", () => {
      seedRecording();
      const succeeded = seedJob("job-s", "rec-1", "SUCCEEDED");
      const failed = seedJob("job-f", "rec-1", "FAILED");

      manager = new JobManager(makeDeps());
      manager.track(succeeded);
      manager.track(failed);

      expect(manager.activeCount).toBe(0);
    });

    test("stops polling when all jobs complete", async () => {
      seedRecording();
      const job = seedJob();

      let pollCount = 0;
      const provider = makeProvider(async () => {
        pollCount++;
        // Succeed on first poll
        return makePollResponse("SUCCEEDED");
      });

      manager = new JobManager(makeDeps({
        getProvider: () => provider,
      }));
      manager.track(job);

      await waitFor(() => manager.activeCount === 0);
      expect(manager.activeCount).toBe(0);

      // Record poll count and wait — should not increase
      const countAfterDone = pollCount;
      await new Promise((r) => setTimeout(r, 100));
      expect(pollCount).toBe(countAfterDone);
    });
  });

  describe("event emission", () => {
    test("emits event when job status changes", async () => {
      seedRecording();
      const job = seedJob();

      const events: JobEvent[] = [];
      const provider = makeProvider(async () => makePollResponse("RUNNING"));

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      manager.onJobEvent((e) => events.push(e));
      manager.track(job);

      await waitFor(() => events.length > 0);

      expect(events[0]).toEqual({
        jobId: "job-1",
        recordingId: "rec-1",
        status: "RUNNING",
        previousStatus: "PENDING",
      });
    });

    test("emits event on terminal state", async () => {
      seedRecording();
      const job = seedJob("job-1", "rec-1", "RUNNING");

      const events: JobEvent[] = [];
      const provider = makeProvider(async () => makePollResponse("SUCCEEDED"));

      manager = new JobManager(makeDeps({
        getProvider: () => provider,
      }));
      manager.onJobEvent((e) => events.push(e));
      manager.track(job);

      await waitFor(() => events.length > 0);

      expect(events[0].status).toBe("SUCCEEDED");
      expect(events[0].previousStatus).toBe("RUNNING");
    });

    test("does not emit when status is unchanged", async () => {
      seedRecording();
      const job = seedJob();

      const events: JobEvent[] = [];
      let pollCount = 0;
      const provider = makeProvider(async () => {
        pollCount++;
        return makePollResponse("PENDING");
      });

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      manager.onJobEvent((e) => events.push(e));
      manager.track(job);

      // Wait for at least 2 polls
      await waitFor(() => pollCount >= 2);
      expect(events).toHaveLength(0);
    });

    test("unsubscribe stops receiving events", async () => {
      seedRecording();
      const job = seedJob();

      const events: JobEvent[] = [];
      const provider = makeProvider(async () => makePollResponse("RUNNING"));

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      const unsubscribe = manager.onJobEvent((e) => events.push(e));

      // Unsubscribe before tracking
      unsubscribe();
      manager.track(job);

      await waitFor(() => manager.activeCount === 0 || true, 200);
      // Give polling a chance to run
      await new Promise((r) => setTimeout(r, 100));
      expect(events).toHaveLength(0);
    });
  });

  describe("recovery from DB", () => {
    test("start() recovers active jobs from database", async () => {
      seedRecording("rec-1");
      seedRecording("rec-2");
      seedJob("job-1", "rec-1", "PENDING");
      seedJob("job-2", "rec-2", "RUNNING");
      // This one should NOT be recovered:
      seedJob("job-3", "rec-1", "SUCCEEDED");

      let pollCount = 0;
      const provider = makeProvider(async () => {
        pollCount++;
        return makePollResponse("PENDING");
      });

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      manager.start();

      expect(manager.activeCount).toBe(2);
      expect(manager.isTracking("job-1")).toBe(true);
      expect(manager.isTracking("job-2")).toBe(true);
      expect(manager.isTracking("job-3")).toBe(false);

      await waitFor(() => pollCount > 0);
    });

    test("start() is idempotent", () => {
      manager = new JobManager(makeDeps());
      manager.start();
      manager.start();
      manager.start();
      // No error thrown, no duplicate recovery
    });
  });

  describe("error resilience", () => {
    test("continues polling other jobs when one fails", async () => {
      seedRecording("rec-1");
      seedRecording("rec-2");
      const job1 = seedJob("job-1", "rec-1", "PENDING");
      const job2 = seedJob("job-2", "rec-2", "PENDING");

      const events: JobEvent[] = [];

      const provider = makeProvider(async (taskId) => {
        if (taskId === "task-job-1") {
          throw new Error("Network error");
        }
        return makePollResponse("RUNNING");
      });

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      manager.onJobEvent((e) => events.push(e));
      manager.track(job1);
      manager.track(job2);

      // Wait for job-2 to transition
      await waitFor(() => events.length > 0);

      // job-2 should have changed; job-1 should still be tracked (retry next cycle)
      expect(events.some((e) => e.jobId === "job-2")).toBe(true);
      expect(manager.isTracking("job-1")).toBe(true);
    });

    test("listener errors do not break polling", async () => {
      seedRecording();
      const job = seedJob();

      const events: JobEvent[] = [];
      let pollRound = 0;
      const provider = makeProvider(async () => {
        pollRound++;
        if (pollRound === 1) return makePollResponse("RUNNING");
        return makePollResponse("SUCCEEDED");
      });

      manager = new JobManager(makeDeps({ getProvider: () => provider }));

      // Bad listener
      manager.onJobEvent(() => {
        throw new Error("Listener crash");
      });
      // Good listener
      manager.onJobEvent((e) => events.push(e));

      manager.track(job);

      await waitFor(() => events.some((e) => e.status === "SUCCEEDED"), 3000);
      expect(events).toHaveLength(2); // RUNNING then SUCCEEDED
    });
  });

  describe("stop", () => {
    test("stops polling and clears state", async () => {
      seedRecording();
      const job = seedJob();

      let pollCount = 0;
      const provider = makeProvider(async () => {
        pollCount++;
        return makePollResponse("PENDING");
      });

      manager = new JobManager(makeDeps({ getProvider: () => provider }));
      manager.track(job);

      await waitFor(() => pollCount > 0);
      manager.stop();

      const countAfterStop = pollCount;
      await new Promise((r) => setTimeout(r, 100));
      expect(pollCount).toBe(countAfterStop);
      expect(manager.activeCount).toBe(0);
    });
  });
});
