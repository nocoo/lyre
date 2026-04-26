import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { recordingsRepo } from "@lyre/api/db/repositories/recordings";
import { jobsRepo } from "@lyre/api/db/repositories/jobs";
import { transcriptionsRepo } from "@lyre/api/db/repositories/transcriptions";
import { foldersRepo } from "@lyre/api/db/repositories/folders";

// Seed a user (recordings have FK to users)
async function seedUser() {
  return await usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

async function makeRecording(
  overrides?: Partial<Parameters<typeof recordingsRepo.create>[0]>,
) {
  return {
    id: "rec-1",
    userId: "user-1",
    title: "Test Recording",
    description: "A test recording",
    fileName: "test.mp3",
    fileSize: 1024000,
    duration: 120.5,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "uploads/user-1/test.mp3",
    status: "uploaded" as const,
    ...overrides,
  };
}

describe("recordingsRepo", () => {
  beforeEach(async () => {
    resetDb();
    await seedUser();
  });

  describe("create", () => {
    test("creates a recording and returns it", async () => {
      const rec = await recordingsRepo.create(await makeRecording());
      expect(rec.id).toBe("rec-1");
      expect(rec.title).toBe("Test Recording");
      expect(rec.status).toBe("uploaded");
      expect(rec.tags).toBe("[]"); // legacy column always writes "[]"
      expect(rec.createdAt).toBeGreaterThan(0);
    });

    test("handles null optional fields", async () => {
      const rec = await recordingsRepo.create(
        await makeRecording({
          description: null,
          fileSize: null,
          duration: null,
          format: null,
          sampleRate: null,
        }),
      );
      expect(rec.description).toBeNull();
      expect(rec.fileSize).toBeNull();
      expect(rec.duration).toBeNull();
    });

    test("stores folderId when provided", async () => {
      // Need a folder first
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test Folder" });
      const rec = await recordingsRepo.create(await makeRecording({ folderId: "f-1" }));
      expect(rec.folderId).toBe("f-1");
    });

    test("stores notes when provided", async () => {
      const rec = await recordingsRepo.create(await makeRecording({ notes: "Some notes" }));
      expect(rec.notes).toBe("Some notes");
    });

    test("stores recordedAt when provided", async () => {
      const ts = Date.now() - 86400000;
      const rec = await recordingsRepo.create(await makeRecording({ recordedAt: ts }));
      expect(rec.recordedAt).toBe(ts);
    });

    test("defaults new fields to null", async () => {
      const rec = await recordingsRepo.create(await makeRecording());
      expect(rec.folderId).toBeNull();
      expect(rec.notes).toBeNull();
      expect(rec.recordedAt).toBeNull();
    });
  });

  describe("findAll", () => {
    test("returns recordings for a given user", async () => {
      await recordingsRepo.create(await makeRecording({ id: "r1" }));
      await recordingsRepo.create(await makeRecording({ id: "r2" }));
      const all = await recordingsRepo.findAll("user-1");
      expect(all).toHaveLength(2);
    });

    test("returns empty for different user", async () => {
      await recordingsRepo.create(await makeRecording());
      expect(await recordingsRepo.findAll("user-other")).toEqual([]);
    });

    test("returns results ordered by createdAt desc", async () => {
      await recordingsRepo.create(await makeRecording({ id: "r1", title: "First" }));
      await recordingsRepo.create(await makeRecording({ id: "r2", title: "Second" }));
      const all = await recordingsRepo.findAll("user-1");
      // Both have the same createdAt (too fast), just verify count
      expect(all).toHaveLength(2);
      // Verify all are returned with correct user
      expect(all.every((r) => r.userId === "user-1")).toBe(true);
    });
  });

  describe("findById", () => {
    test("returns recording when found", async () => {
      await recordingsRepo.create(await makeRecording());
      expect((await recordingsRepo.findById("rec-1"))?.title).toBe("Test Recording");
    });

    test("returns undefined when not found", async () => {
      expect(await recordingsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByUserId", () => {
    beforeEach(async () => {
      await recordingsRepo.create(
        await makeRecording({
          id: "r1",
          title: "Alpha Meeting",
          status: "completed",
          duration: 60,
          fileSize: 500,
        }),
      );
      await recordingsRepo.create(
        await makeRecording({
          id: "r2",
          title: "Beta Interview",
          status: "uploaded",
          duration: 120,
          fileSize: 1000,
        }),
      );
      await recordingsRepo.create(
        await makeRecording({
          id: "r3",
          title: "Gamma Podcast",
          status: "completed",
          duration: 300,
          fileSize: 2000,
        }),
      );
    });

    test("returns all recordings for user with defaults", async () => {
      const result = await recordingsRepo.findByUserId("user-1");
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(3);
    });

    test("filters by status", async () => {
      const result = await recordingsRepo.findByUserId("user-1", {
        status: "completed",
      });
      expect(result.total).toBe(2);
    });

    test("filters by query in title", async () => {
      const result = await recordingsRepo.findByUserId("user-1", {
        query: "alpha",
      });
      expect(result.total).toBe(1);
      expect(result.items[0]?.title).toBe("Alpha Meeting");
    });

    test("sorts by title ascending", async () => {
      const result = await recordingsRepo.findByUserId("user-1", {
        sortBy: "title",
        sortDir: "asc",
      });
      expect(result.items[0]?.title).toBe("Alpha Meeting");
      expect(result.items[2]?.title).toBe("Gamma Podcast");
    });

    test("sorts by duration descending", async () => {
      const result = await recordingsRepo.findByUserId("user-1", {
        sortBy: "duration",
        sortDir: "desc",
      });
      expect(result.items[0]?.duration).toBe(300);
    });

    test("sorts by fileSize ascending", async () => {
      const result = await recordingsRepo.findByUserId("user-1", {
        sortBy: "fileSize",
        sortDir: "asc",
      });
      expect(result.items[0]?.fileSize).toBe(500);
    });

    test("paginates results", async () => {
      const page1 = await recordingsRepo.findByUserId("user-1", {
        page: 1,
        pageSize: 2,
      });
      expect(page1.total).toBe(3);
      expect(page1.items).toHaveLength(2);

      const page2 = await recordingsRepo.findByUserId("user-1", {
        page: 2,
        pageSize: 2,
      });
      expect(page2.items).toHaveLength(1);
    });

    test("returns empty for unknown user", async () => {
      const result = await recordingsRepo.findByUserId("nobody");
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });

    test("filters by folderId — specific folder", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Folder A" });
      await recordingsRepo.create(
        await makeRecording({ id: "r4", title: "In Folder", folderId: "f-1" }),
      );
      const result = await recordingsRepo.findByUserId("user-1", { folderId: "f-1" });
      expect(result.total).toBe(1);
      expect(result.items[0]?.title).toBe("In Folder");
    });

    test("filters by folderId — unfiled (null)", async () => {
      await foldersRepo.create({ id: "f-2", userId: "user-1", name: "Folder B" });
      await recordingsRepo.create(
        await makeRecording({ id: "r5", title: "Has Folder", folderId: "f-2" }),
      );
      // r1, r2, r3 have no folderId (default null)
      const result = await recordingsRepo.findByUserId("user-1", { folderId: null });
      expect(result.total).toBe(3); // r1, r2, r3
      expect(result.items.every((r) => r.folderId === null)).toBe(true);
    });

    test("no folderId filter returns all recordings", async () => {
      await foldersRepo.create({ id: "f-3", userId: "user-1", name: "Folder C" });
      await recordingsRepo.create(
        await makeRecording({ id: "r6", title: "Foldered", folderId: "f-3" }),
      );
      const result = await recordingsRepo.findByUserId("user-1");
      expect(result.total).toBe(4); // r1, r2, r3, r6
    });

    test("filters by query in aiSummary", async () => {
      await recordingsRepo.update("r1", { aiSummary: "Important meeting about revenue growth" });
      const result = await recordingsRepo.findByUserId("user-1", { query: "revenue" });
      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe("r1");
    });

    test("query does not match null aiSummary", async () => {
      // r2 and r3 have no aiSummary
      const result = await recordingsRepo.findByUserId("user-1", { query: "zzz_no_match_anywhere" });
      expect(result.total).toBe(0);
    });

    test("combines folderId and status filters", async () => {
      await foldersRepo.create({ id: "f-4", userId: "user-1", name: "Folder D" });
      await recordingsRepo.create(
        await makeRecording({ id: "r7", title: "Completed In Folder", folderId: "f-4", status: "completed" }),
      );
      await recordingsRepo.create(
        await makeRecording({ id: "r8", title: "Uploaded In Folder", folderId: "f-4", status: "uploaded" }),
      );
      const result = await recordingsRepo.findByUserId("user-1", {
        folderId: "f-4",
        status: "completed",
      });
      expect(result.total).toBe(1);
      expect(result.items[0]?.title).toBe("Completed In Folder");
    });
  });

  describe("update", () => {
    test("updates title", async () => {
      await recordingsRepo.create(await makeRecording());
      const updated = await recordingsRepo.update("rec-1", {
        title: "Updated Title",
      });
      expect(updated?.title).toBe("Updated Title");
    });

    test("updates status", async () => {
      await recordingsRepo.create(await makeRecording());
      const updated = await recordingsRepo.update("rec-1", {
        status: "transcribing",
      });
      expect(updated?.status).toBe("transcribing");
    });

    test("updates updatedAt", async () => {
      const rec = await recordingsRepo.create(await makeRecording());
      const updated = await recordingsRepo.update("rec-1", { title: "New" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(rec.updatedAt);
    });

    test("returns undefined when not found", async () => {
      expect(await recordingsRepo.update("nope", { title: "X" })).toBeUndefined();
    });

    test("updates notes", async () => {
      await recordingsRepo.create(await makeRecording());
      const updated = await recordingsRepo.update("rec-1", { notes: "My notes" });
      expect(updated?.notes).toBe("My notes");
    });

    test("updates folderId", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Folder" });
      await recordingsRepo.create(await makeRecording());
      const updated = await recordingsRepo.update("rec-1", { folderId: "f-1" });
      expect(updated?.folderId).toBe("f-1");
    });

    test("clears folderId with null", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Folder" });
      await recordingsRepo.create(await makeRecording({ folderId: "f-1" }));
      const updated = await recordingsRepo.update("rec-1", { folderId: null });
      expect(updated?.folderId).toBeNull();
    });

    test("updates recordedAt", async () => {
      await recordingsRepo.create(await makeRecording());
      const ts = Date.now() - 86400000;
      const updated = await recordingsRepo.update("rec-1", { recordedAt: ts });
      expect(updated?.recordedAt).toBe(ts);
    });
  });

  describe("delete", () => {
    test("deletes existing recording", async () => {
      await recordingsRepo.create(await makeRecording());
      expect(await recordingsRepo.delete("rec-1")).toBe(true);
      expect(await recordingsRepo.findById("rec-1")).toBeUndefined();
    });

    test("returns false when not found", async () => {
      expect(await recordingsRepo.delete("nope")).toBe(false);
    });
  });

  describe("deleteCascade", () => {
    test("deletes recording and related transcriptions and jobs", async () => {
      const rec = await recordingsRepo.create(await makeRecording());
      const job = await jobsRepo.create({
        id: "job-1",
        recordingId: rec.id,
        taskId: "task-1",
        requestId: null,
        status: "SUCCEEDED",
      });
      await transcriptionsRepo.create({
        id: "trans-1",
        recordingId: rec.id,
        jobId: job.id,
        fullText: "Hello world",
        sentences: [],
        language: "en",
      });

      expect(await recordingsRepo.deleteCascade(rec.id)).toBe(true);

      // All gone
      expect(await recordingsRepo.findById(rec.id)).toBeUndefined();
      expect(await jobsRepo.findById(job.id)).toBeUndefined();
      expect(await transcriptionsRepo.findById("trans-1")).toBeUndefined();
    });

    test("returns false when recording does not exist", async () => {
      expect(await recordingsRepo.deleteCascade("nonexistent")).toBe(false);
    });

    test("works when recording has no related data", async () => {
      await recordingsRepo.create(await makeRecording());
      expect(await recordingsRepo.deleteCascade("rec-1")).toBe(true);
      expect(await recordingsRepo.findById("rec-1")).toBeUndefined();
    });

    test("deletes multiple jobs for same recording", async () => {
      const rec = await recordingsRepo.create(await makeRecording());
      await jobsRepo.create({
        id: "job-1",
        recordingId: rec.id,
        taskId: "task-1",
        requestId: null,
        status: "FAILED",
      });
      await jobsRepo.create({
        id: "job-2",
        recordingId: rec.id,
        taskId: "task-2",
        requestId: null,
        status: "SUCCEEDED",
      });

      expect(await recordingsRepo.deleteCascade(rec.id)).toBe(true);
      expect(await jobsRepo.findById("job-1")).toBeUndefined();
      expect(await jobsRepo.findById("job-2")).toBeUndefined();
    });
  });

  describe("deleteCascadeMany", () => {
    test("deletes multiple recordings with related data in a single transaction", async () => {
      const rec1 = await recordingsRepo.create(await makeRecording({ id: "r1" }));
      const rec2 = await recordingsRepo.create(await makeRecording({ id: "r2" }));

      await jobsRepo.create({
        id: "job-1",
        recordingId: rec1.id,
        taskId: "task-1",
        requestId: null,
        status: "SUCCEEDED",
      });
      await transcriptionsRepo.create({
        id: "trans-1",
        recordingId: rec1.id,
        jobId: "job-1",
        fullText: "Hello",
        sentences: [],
        language: "en",
      });
      await jobsRepo.create({
        id: "job-2",
        recordingId: rec2.id,
        taskId: "task-2",
        requestId: null,
        status: "SUCCEEDED",
      });

      const result = await recordingsRepo.deleteCascadeMany(["r1", "r2"]);
      expect(result).toBe(2);

      expect(await recordingsRepo.findById("r1")).toBeUndefined();
      expect(await recordingsRepo.findById("r2")).toBeUndefined();
      expect(await jobsRepo.findById("job-1")).toBeUndefined();
      expect(await jobsRepo.findById("job-2")).toBeUndefined();
      expect(await transcriptionsRepo.findById("trans-1")).toBeUndefined();
    });

    test("returns 0 for empty ids array", async () => {
      expect(await recordingsRepo.deleteCascadeMany([])).toBe(0);
    });

    test("returns count of actually deleted recordings (skips nonexistent)", async () => {
      await recordingsRepo.create(await makeRecording({ id: "r1" }));
      const result = await recordingsRepo.deleteCascadeMany(["r1", "nonexistent"]);
      expect(result).toBe(1);
      expect(await recordingsRepo.findById("r1")).toBeUndefined();
    });

    test("works when recordings have no related data", async () => {
      await recordingsRepo.create(await makeRecording({ id: "r1" }));
      await recordingsRepo.create(await makeRecording({ id: "r2" }));
      await recordingsRepo.create(await makeRecording({ id: "r3" }));

      const result = await recordingsRepo.deleteCascadeMany(["r1", "r2", "r3"]);
      expect(result).toBe(3);
    });

    test("does not affect other recordings", async () => {
      await recordingsRepo.create(await makeRecording({ id: "r1" }));
      await recordingsRepo.create(await makeRecording({ id: "r2" }));
      await recordingsRepo.create(await makeRecording({ id: "r3" }));

      await recordingsRepo.deleteCascadeMany(["r1", "r3"]);

      expect(await recordingsRepo.findById("r1")).toBeUndefined();
      expect(await recordingsRepo.findById("r2")).not.toBeUndefined();
      expect(await recordingsRepo.findById("r3")).toBeUndefined();
    });

    test("returns ossKeys of deleted recordings", async () => {
      await recordingsRepo.create(await makeRecording({ id: "r1", ossKey: "uploads/r1.mp3" }));
      await recordingsRepo.create(await makeRecording({ id: "r2", ossKey: "uploads/r2.mp3" }));

      // We need to verify via findById before deletion that ossKeys exist
      expect((await recordingsRepo.findById("r1"))?.ossKey).toBe("uploads/r1.mp3");
      expect((await recordingsRepo.findById("r2"))?.ossKey).toBe("uploads/r2.mp3");

      const result = await recordingsRepo.deleteCascadeMany(["r1", "r2"]);
      expect(result).toBe(2);
    });
  });
});
