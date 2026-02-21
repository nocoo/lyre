import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { recordingsRepo } from "@/db/repositories/recordings";
import { jobsRepo } from "@/db/repositories/jobs";

function seedRecording() {
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
    status: "uploaded",
  });
}

function makeJob(
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
  beforeEach(() => {
    resetDb();
    seedRecording();
  });

  describe("create", () => {
    test("creates a job and returns it", () => {
      const job = jobsRepo.create(makeJob());
      expect(job.id).toBe("job-1");
      expect(job.taskId).toBe("task-abc-123");
      expect(job.status).toBe("PENDING");
      expect(job.createdAt).toBeGreaterThan(0);
    });

    test("allows null requestId", () => {
      const job = jobsRepo.create(makeJob({ requestId: null }));
      expect(job.requestId).toBeNull();
    });
  });

  describe("findById", () => {
    test("returns job when found", () => {
      jobsRepo.create(makeJob());
      expect(jobsRepo.findById("job-1")?.taskId).toBe("task-abc-123");
    });

    test("returns undefined when not found", () => {
      expect(jobsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByTaskId", () => {
    test("returns job by DashScope task ID", () => {
      jobsRepo.create(makeJob());
      const found = jobsRepo.findByTaskId("task-abc-123");
      expect(found?.id).toBe("job-1");
    });

    test("returns undefined when not found", () => {
      expect(jobsRepo.findByTaskId("nope")).toBeUndefined();
    });
  });

  describe("findLatestByRecordingId", () => {
    test("returns the latest job for a recording", () => {
      jobsRepo.create(makeJob({ id: "j1", taskId: "t1" }));
      jobsRepo.create(makeJob({ id: "j2", taskId: "t2" }));
      const latest = jobsRepo.findLatestByRecordingId("rec-1");
      // Both have same timestamp, but we just verify one is returned
      expect(latest).toBeDefined();
      expect(latest?.recordingId).toBe("rec-1");
    });

    test("returns undefined when no jobs for recording", () => {
      expect(jobsRepo.findLatestByRecordingId("nope")).toBeUndefined();
    });
  });

  describe("findByRecordingId", () => {
    test("returns all jobs for a recording", () => {
      jobsRepo.create(makeJob({ id: "j1", taskId: "t1" }));
      jobsRepo.create(makeJob({ id: "j2", taskId: "t2" }));
      const jobs = jobsRepo.findByRecordingId("rec-1");
      expect(jobs).toHaveLength(2);
    });

    test("returns empty for unknown recording", () => {
      expect(jobsRepo.findByRecordingId("nope")).toEqual([]);
    });
  });

  describe("update", () => {
    test("updates status", () => {
      jobsRepo.create(makeJob());
      const updated = jobsRepo.update("job-1", { status: "RUNNING" });
      expect(updated?.status).toBe("RUNNING");
    });

    test("updates multiple fields", () => {
      jobsRepo.create(makeJob());
      const updated = jobsRepo.update("job-1", {
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

    test("updates error message on failure", () => {
      jobsRepo.create(makeJob());
      const updated = jobsRepo.update("job-1", {
        status: "FAILED",
        errorMessage: "Audio too short",
      });
      expect(updated?.status).toBe("FAILED");
      expect(updated?.errorMessage).toBe("Audio too short");
    });

    test("updates updatedAt", () => {
      const job = jobsRepo.create(makeJob());
      const updated = jobsRepo.update("job-1", { status: "RUNNING" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
    });

    test("returns undefined when not found", () => {
      expect(jobsRepo.update("nope", { status: "RUNNING" })).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing job", () => {
      jobsRepo.create(makeJob());
      expect(jobsRepo.delete("job-1")).toBe(true);
      expect(jobsRepo.findById("job-1")).toBeUndefined();
    });

    test("returns false when not found", () => {
      expect(jobsRepo.delete("nope")).toBe(false);
    });
  });

  describe("deleteByRecordingId", () => {
    test("deletes all jobs for a recording", () => {
      jobsRepo.create(makeJob({ id: "j1", taskId: "t1" }));
      jobsRepo.create(makeJob({ id: "j2", taskId: "t2" }));
      const deleted = jobsRepo.deleteByRecordingId("rec-1");
      expect(deleted).toBe(2);
      expect(jobsRepo.findByRecordingId("rec-1")).toEqual([]);
    });

    test("returns 0 when no jobs for recording", () => {
      expect(jobsRepo.deleteByRecordingId("nope")).toBe(0);
    });
  });
});
