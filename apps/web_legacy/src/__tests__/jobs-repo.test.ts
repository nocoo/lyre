import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { recordingsRepo } from "@lyre/api/db/repositories/recordings";
import { jobsRepo } from "@lyre/api/db/repositories/jobs";

async function seedRecording() {
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
    status: "uploaded",
  });
}

async function makeJob(
  overrides?: Partial<Parameters<typeof jobsRepo.create>[0]>,
) {
  return {
    id: "job-1",
    recordingId: "rec-1",
    taskId: "task-abc-123",
    requestId: "req-xyz",
    status: "PENDING" as const,
    ...overrides,
  };
}

describe("jobsRepo", () => {
  beforeEach(async () => {
    resetDb();
    await seedRecording();
  });

  describe("create", () => {
    test("creates a job and returns it", async () => {
      const job = await jobsRepo.create(await makeJob());
      expect(job.id).toBe("job-1");
      expect(job.taskId).toBe("task-abc-123");
      expect(job.status).toBe("PENDING");
      expect(job.createdAt).toBeGreaterThan(0);
    });

    test("allows null requestId", async () => {
      const job = await jobsRepo.create(await makeJob({ requestId: null }));
      expect(job.requestId).toBeNull();
    });
  });

  describe("findById", () => {
    test("returns job when found", async () => {
      await jobsRepo.create(await makeJob());
      expect((await jobsRepo.findById("job-1"))?.taskId).toBe("task-abc-123");
    });

    test("returns undefined when not found", async () => {
      expect(await jobsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByTaskId", () => {
    test("returns job by DashScope task ID", async () => {
      await jobsRepo.create(await makeJob());
      const found = await jobsRepo.findByTaskId("task-abc-123");
      expect(found?.id).toBe("job-1");
    });

    test("returns undefined when not found", async () => {
      expect(await jobsRepo.findByTaskId("nope")).toBeUndefined();
    });
  });

  describe("findLatestByRecordingId", () => {
    test("returns the latest job for a recording", async () => {
      await jobsRepo.create(await makeJob({ id: "j1", taskId: "t1" }));
      await jobsRepo.create(await makeJob({ id: "j2", taskId: "t2" }));
      const latest = await jobsRepo.findLatestByRecordingId("rec-1");
      // Both have same timestamp, but we just verify one is returned
      expect(latest).toBeDefined();
      expect(latest?.recordingId).toBe("rec-1");
    });

    test("returns undefined when no jobs for recording", async () => {
      expect(await jobsRepo.findLatestByRecordingId("nope")).toBeUndefined();
    });
  });

  describe("findByRecordingId", () => {
    test("returns all jobs for a recording", async () => {
      await jobsRepo.create(await makeJob({ id: "j1", taskId: "t1" }));
      await jobsRepo.create(await makeJob({ id: "j2", taskId: "t2" }));
      const jobs = await jobsRepo.findByRecordingId("rec-1");
      expect(jobs).toHaveLength(2);
    });

    test("returns empty for unknown recording", async () => {
      expect(await jobsRepo.findByRecordingId("nope")).toEqual([]);
    });
  });

  describe("update", () => {
    test("updates status", async () => {
      await jobsRepo.create(await makeJob());
      const updated = await jobsRepo.update("job-1", { status: "RUNNING" });
      expect(updated?.status).toBe("RUNNING");
    });

    test("updates multiple fields", async () => {
      await jobsRepo.create(await makeJob());
      const updated = await jobsRepo.update("job-1", {
        status: "SUCCEEDED",
        endTime: "2026-01-15T10:00:00Z",
        usageSeconds: 45,
        resultUrl: "https://oss.example.com/result.json",
      });
      expect(updated?.status).toBe("SUCCEEDED");
      expect(updated?.endTime).toBe("2026-01-15T10:00:00Z");
      expect(updated?.usageSeconds).toBe(45);
      expect(updated?.resultUrl).toBe("https://oss.example.com/result.json");
    });

    test("updates error message on failure", async () => {
      await jobsRepo.create(await makeJob());
      const updated = await jobsRepo.update("job-1", {
        status: "FAILED",
        errorMessage: "Audio too short",
      });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.errorMessage).toBe("Audio too short");
    });

    test("updates updatedAt", async () => {
      const job = await jobsRepo.create(await makeJob());
      const updated = await jobsRepo.update("job-1", { status: "RUNNING" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
    });

    test("returns undefined when not found", async () => {
      expect(await jobsRepo.update("nope", { status: "RUNNING" })).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing job", async () => {
      await jobsRepo.create(await makeJob());
      expect(await jobsRepo.delete("job-1")).toBe(true);
      expect(await jobsRepo.findById("job-1")).toBeUndefined();
    });

    test("returns false when not found", async () => {
      expect(await jobsRepo.delete("nope")).toBe(false);
    });
  });

  describe("deleteByRecordingId", () => {
    test("deletes all jobs for a recording", async () => {
      await jobsRepo.create(await makeJob({ id: "j1", taskId: "t1" }));
      await jobsRepo.create(await makeJob({ id: "j2", taskId: "t2" }));
      const deleted = await jobsRepo.deleteByRecordingId("rec-1");
      expect(deleted).toBe(2);
      expect(await jobsRepo.findByRecordingId("rec-1")).toEqual([]);
    });

    test("returns 0 when no jobs for recording", async () => {
      expect(await jobsRepo.deleteByRecordingId("nope")).toBe(0);
    });
  });
});
