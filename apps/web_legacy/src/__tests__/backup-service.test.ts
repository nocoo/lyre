/**
 * Tests for the backup service (export + import + validation).
 *
 * Covers: full round-trip, partial data, upsert semantics,
 * cross-user re-keying, validation edge cases, and empty backups.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { foldersRepo } from "@lyre/api/db/repositories/folders";
import { tagsRepo } from "@lyre/api/db/repositories/tags";
import { recordingsRepo } from "@lyre/api/db/repositories/recordings";
import { jobsRepo } from "@lyre/api/db/repositories/jobs";
import { transcriptionsRepo } from "@lyre/api/db/repositories/transcriptions";
import { deviceTokensRepo } from "@lyre/api/db/repositories/device-tokens";
import { settingsRepo } from "@lyre/api/db/repositories/settings";
import {
  exportBackup,
  importBackup,
  validateBackup,
  pushBackupToBacky,
  type BackupData,
} from "@lyre/api/services/backup";

// ── Helpers ──

async function seedUser(id = "user-1", email = "alice@test.com") {
  return await usersRepo.create({ id, email, name: "Alice", avatarUrl: null });
}

async function seedFullData(userId: string) {
  // Folder
  await foldersRepo.create({ id: "f-1", userId, name: "Work", icon: "briefcase" });

  // Tags
  await tagsRepo.create({ id: "t-1", userId, name: "meeting" });
  await tagsRepo.create({ id: "t-2", userId, name: "important" });

  // Recording in folder
  await recordingsRepo.create({
    id: "rec-1",
    userId,
    title: "Standup Call",
    description: "Daily standup",
    fileName: "standup.mp3",
    fileSize: 1024000,
    duration: 120.5,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "uploads/user-1/rec-1/standup.mp3",
    status: "completed",
    folderId: "f-1",
    notes: "Good discussion",
    recordedAt: 1700000000000,
  });

  // Recording without folder
  await recordingsRepo.create({
    id: "rec-2",
    userId,
    title: "Quick Note",
    description: null,
    fileName: "note.wav",
    fileSize: 512000,
    duration: 30,
    format: "wav",
    sampleRate: 48000,
    ossKey: "uploads/user-1/rec-2/note.wav",
    status: "uploaded",
  });

  // Recording tags (join table)
  await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);

  // Job + transcription for rec-1
  await jobsRepo.create({
    id: "job-1",
    recordingId: "rec-1",
    taskId: "dash-task-1",
    requestId: "req-1",
    status: "SUCCEEDED",
  });
  await transcriptionsRepo.create({
    id: "trans-1",
    recordingId: "rec-1",
    jobId: "job-1",
    fullText: "Hello team, let's start the standup.",
    sentences: [
      {
        sentenceId: 1,
        beginTime: 0,
        endTime: 3000,
        text: "Hello team, let's start the standup.",
        language: "en",
        emotion: "neutral",
      },
    ],
    language: "en",
  });

  // Device token
  await deviceTokensRepo.create({
    id: "dt-1",
    userId,
    name: "MacBook",
    tokenHash: "abc123hash",
  });

  // Settings
  await settingsRepo.upsert(userId, "ai.provider", "openai");
  await settingsRepo.upsert(userId, "ai.model", "gpt-4");
}

function makeMinimalBackup(overrides?: Partial<BackupData>): BackupData {
  return {
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "alice@test.com",
      name: "Alice",
      avatarUrl: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
    folders: [],
    tags: [],
    recordings: [],
    transcriptionJobs: [],
    transcriptions: [],
    recordingTags: [],
    deviceTokens: [],
    settings: [],
    ...overrides,
  };
}

// ── Tests ──

describe("backup service", () => {
  beforeEach(async () => {
    resetDb();
  });

  // ── validateBackup ──

  describe("validateBackup", () => {
    test("accepts valid backup", async () => {
      expect(validateBackup(makeMinimalBackup())).toBeNull();
    });

    test("rejects null", async () => {
      expect(validateBackup(null)).toBe("expected an object");
    });

    test("rejects non-object", async () => {
      expect(validateBackup("string")).toBe("expected an object");
      expect(validateBackup(42)).toBe("expected an object");
    });

    test("rejects wrong version", async () => {
      expect(validateBackup({ ...makeMinimalBackup(), version: 2 })).toBe(
        "unsupported version (expected 1)",
      );
    });

    test("rejects missing version", async () => {
      const data = makeMinimalBackup();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (data as any).version;
      expect(validateBackup(data)).toBe("unsupported version (expected 1)");
    });

    test("rejects missing exportedAt", async () => {
      const data = makeMinimalBackup();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (data as any).exportedAt;
      expect(validateBackup(data)).toBe("missing exportedAt");
    });

    test("rejects missing user object", async () => {
      const data = makeMinimalBackup();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (data as any).user;
      expect(validateBackup(data)).toBe("missing user object");
    });

    test("rejects missing required arrays", async () => {
      const arrays = [
        "folders",
        "tags",
        "recordings",
        "transcriptionJobs",
        "transcriptions",
        "recordingTags",
        "deviceTokens",
        "settings",
      ];

      for (const key of arrays) {
        const data = makeMinimalBackup();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (data as any)[key];
        expect(validateBackup(data)).toBe(`missing or invalid ${key} array`);
      }
    });

    test("rejects non-array for required fields", async () => {
      const data = makeMinimalBackup();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any).folders = "not-array";
      expect(validateBackup(data)).toBe("missing or invalid folders array");
    });
  });

  // ── exportBackup ──

  describe("exportBackup", () => {
    test("exports empty data for user with no records", async () => {
      const user = await seedUser();
      const backup = await exportBackup(user);

      expect(backup.version).toBe(1);
      expect(backup.exportedAt).toBeDefined();
      expect(backup.user.id).toBe("user-1");
      expect(backup.user.email).toBe("alice@test.com");
      expect(backup.folders).toEqual([]);
      expect(backup.tags).toEqual([]);
      expect(backup.recordings).toEqual([]);
      expect(backup.transcriptionJobs).toEqual([]);
      expect(backup.transcriptions).toEqual([]);
      expect(backup.recordingTags).toEqual([]);
      expect(backup.deviceTokens).toEqual([]);
      expect(backup.settings).toEqual([]);
    });

    test("exports all user data", async () => {
      const user = await seedUser();
      await seedFullData(user.id);

      const backup = await exportBackup(user);

      expect(backup.folders).toHaveLength(1);
      expect(backup.folders[0]!.name).toBe("Work");
      expect(backup.folders[0]!.icon).toBe("briefcase");

      expect(backup.tags).toHaveLength(2);
      expect(backup.tags.map((t) => t.name).sort()).toEqual([
        "important",
        "meeting",
      ]);

      expect(backup.recordings).toHaveLength(2);
      expect(backup.recordings.find((r) => r.id === "rec-1")!.title).toBe(
        "Standup Call",
      );
      expect(backup.recordings.find((r) => r.id === "rec-1")!.folderId).toBe(
        "f-1",
      );
      expect(backup.recordings.find((r) => r.id === "rec-2")!.folderId).toBeNull();

      expect(backup.transcriptionJobs).toHaveLength(1);
      expect(backup.transcriptionJobs[0]!.taskId).toBe("dash-task-1");

      expect(backup.transcriptions).toHaveLength(1);
      expect(backup.transcriptions[0]!.fullText).toBe(
        "Hello team, let's start the standup.",
      );

      expect(backup.recordingTags).toHaveLength(2);
      expect(
        backup.recordingTags.every((rt) => rt.recordingId === "rec-1"),
      ).toBe(true);
      expect(backup.recordingTags.map((rt) => rt.tagId).sort()).toEqual([
        "t-1",
        "t-2",
      ]);

      expect(backup.deviceTokens).toHaveLength(1);
      expect(backup.deviceTokens[0]!.name).toBe("MacBook");

      expect(backup.settings).toHaveLength(2);
      expect(backup.settings.find((s) => s.key === "ai.provider")!.value).toBe(
        "openai",
      );
    });

    test("does not include data from other users", async () => {
      const user1 = await seedUser("user-1", "alice@test.com");
      const user2 = await seedUser("user-2", "bob@test.com");

      // Seed data for user-2
      await foldersRepo.create({ id: "f-bob", userId: user2.id, name: "Bob Folder" });
      await tagsRepo.create({ id: "t-bob", userId: user2.id, name: "bob-tag" });
      await settingsRepo.upsert(user2.id, "theme", "dark");

      // Seed data for user-1
      await foldersRepo.create({ id: "f-alice", userId: user1.id, name: "Alice Folder" });

      const backup = await exportBackup(user1);
      expect(backup.folders).toHaveLength(1);
      expect(backup.folders[0]!.name).toBe("Alice Folder");
      expect(backup.tags).toHaveLength(0);
      expect(backup.settings).toHaveLength(0);
    });

    test("exports recording notes and aiSummary", async () => {
      const user = await seedUser();
      await recordingsRepo.create({
        id: "rec-notes",
        userId: user.id,
        title: "With Notes",
        description: null,
        fileName: "notes.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-notes/notes.mp3",
        status: "completed",
        notes: "These are my notes",
      });
      await recordingsRepo.update("rec-notes", { aiSummary: "AI generated summary" });

      const backup = await exportBackup(user);
      expect(backup.recordings[0]!.notes).toBe("These are my notes");
      expect(backup.recordings[0]!.aiSummary).toBe("AI generated summary");
    });
  });

  // ── importBackup ──

  describe("importBackup", () => {
    test("imports empty backup without errors", async () => {
      await seedUser();
      const backup = makeMinimalBackup();
      const counts = await importBackup("user-1", backup);

      expect(counts.folders).toBe(0);
      expect(counts.tags).toBe(0);
      expect(counts.recordings).toBe(0);
      expect(counts.transcriptionJobs).toBe(0);
      expect(counts.transcriptions).toBe(0);
      expect(counts.recordingTags).toBe(0);
      expect(counts.deviceTokens).toBe(0);
      expect(counts.settings).toBe(0);
    });

    test("imports folders", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        folders: [
          {
            id: "f-imported",
            name: "Imported Folder",
            icon: "star",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.folders).toBe(1);

      const folder = await foldersRepo.findById("f-imported");
      expect(folder).toBeDefined();
      expect(folder!.name).toBe("Imported Folder");
      expect(folder!.icon).toBe("star");
      expect(folder!.userId).toBe("user-1");
    });

    test("imports tags", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        tags: [
          { id: "t-imported", name: "imported-tag", createdAt: 1700000000000 },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.tags).toBe(1);

      const tag = await tagsRepo.findById("t-imported");
      expect(tag).toBeDefined();
      expect(tag!.name).toBe("imported-tag");
      expect(tag!.userId).toBe("user-1");
    });

    test("imports recordings with all fields", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        recordings: [
          {
            id: "rec-imported",
            folderId: null,
            title: "Imported Recording",
            description: "Test description",
            fileName: "test.mp3",
            fileSize: 2048,
            duration: 60.5,
            format: "mp3",
            sampleRate: 44100,
            ossKey: "uploads/user-1/rec-imported/test.mp3",
            tags: '["tag1"]',
            notes: "My notes",
            aiSummary: "Summary here",
            recordedAt: 1700000000000,
            status: "completed",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.recordings).toBe(1);

      const rec = await recordingsRepo.findById("rec-imported");
      expect(rec).toBeDefined();
      expect(rec!.title).toBe("Imported Recording");
      expect(rec!.description).toBe("Test description");
      expect(rec!.duration).toBe(60.5);
      expect(rec!.notes).toBe("My notes");
      expect(rec!.aiSummary).toBe("Summary here");
      expect(rec!.userId).toBe("user-1");
    });

    test("imports transcription jobs and transcriptions", async () => {
      await seedUser();
      // Need a recording first
      await recordingsRepo.create({
        id: "rec-1",
        userId: "user-1",
        title: "Test",
        description: null,
        fileName: "test.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-1/test.mp3",
        status: "completed",
      });

      const backup = makeMinimalBackup({
        transcriptionJobs: [
          {
            id: "job-imported",
            recordingId: "rec-1",
            taskId: "task-123",
            requestId: "req-123",
            status: "SUCCEEDED",
            submitTime: "2026-01-01T00:00:00Z",
            endTime: "2026-01-01T00:01:00Z",
            usageSeconds: 60,
            errorMessage: null,
            resultUrl: "https://example.com/result",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        transcriptions: [
          {
            id: "trans-imported",
            recordingId: "rec-1",
            jobId: "job-imported",
            fullText: "Hello world",
            sentences: '[{"sentenceId":1,"beginTime":0,"endTime":1000,"text":"Hello world","language":"en","emotion":"neutral"}]',
            language: "en",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.transcriptionJobs).toBe(1);
      expect(counts.transcriptions).toBe(1);

      const job = await jobsRepo.findById("job-imported");
      expect(job).toBeDefined();
      expect(job!.taskId).toBe("task-123");
      expect(job!.status).toBe("SUCCEEDED");
      expect(job!.usageSeconds).toBe(60);

      const trans = await transcriptionsRepo.findById("trans-imported");
      expect(trans).toBeDefined();
      expect(trans!.fullText).toBe("Hello world");
      expect(trans!.language).toBe("en");
    });

    test("imports recording-tag associations", async () => {
      await seedUser();
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "tag1" });
      await tagsRepo.create({ id: "t-2", userId: "user-1", name: "tag2" });
      await recordingsRepo.create({
        id: "rec-1",
        userId: "user-1",
        title: "Test",
        description: null,
        fileName: "test.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-1/test.mp3",
        status: "uploaded",
      });

      const backup = makeMinimalBackup({
        recordingTags: [
          { recordingId: "rec-1", tagId: "t-1" },
          { recordingId: "rec-1", tagId: "t-2" },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.recordingTags).toBe(2);

      const tagIds = await tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds.sort()).toEqual(["t-1", "t-2"]);
    });

    test("imports device tokens", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        deviceTokens: [
          {
            id: "dt-imported",
            name: "iPhone",
            tokenHash: "hash123",
            lastUsedAt: 1700000000000,
            createdAt: 1700000000000,
          },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.deviceTokens).toBe(1);

      const token = await deviceTokensRepo.findById("dt-imported");
      expect(token).toBeDefined();
      expect(token!.name).toBe("iPhone");
      expect(token!.tokenHash).toBe("hash123");
      expect(token!.userId).toBe("user-1");
    });

    test("imports settings", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        settings: [
          { key: "theme", value: "dark", updatedAt: 1700000000000 },
          { key: "language", value: "zh", updatedAt: 1700000000000 },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.settings).toBe(2);

      const theme = await settingsRepo.findByKey("user-1", "theme");
      expect(theme!.value).toBe("dark");
      const lang = await settingsRepo.findByKey("user-1", "language");
      expect(lang!.value).toBe("zh");
    });

    test("upserts existing folders (update on conflict)", async () => {
      await seedUser();
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Old Name", icon: "folder" });

      const backup = makeMinimalBackup({
        folders: [
          {
            id: "f-1",
            name: "New Name",
            icon: "star",
            createdAt: 1700000000000,
            updatedAt: 1700000001000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const folder = await foldersRepo.findById("f-1");
      expect(folder!.name).toBe("New Name");
      expect(folder!.icon).toBe("star");
    });

    test("upserts existing tags", async () => {
      await seedUser();
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "old-name" });

      const backup = makeMinimalBackup({
        tags: [{ id: "t-1", name: "new-name", createdAt: 1700000000000 }],
      });

      await importBackup("user-1", backup);

      const tag = await tagsRepo.findById("t-1");
      expect(tag!.name).toBe("new-name");
    });

    test("upserts existing recordings", async () => {
      await seedUser();
      await recordingsRepo.create({
        id: "rec-1",
        userId: "user-1",
        title: "Old Title",
        description: null,
        fileName: "test.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-1/test.mp3",
        status: "uploaded",
      });

      const backup = makeMinimalBackup({
        recordings: [
          {
            id: "rec-1",
            folderId: null,
            title: "Updated Title",
            description: "New desc",
            fileName: "test.mp3",
            fileSize: 200,
            duration: 20,
            format: "mp3",
            sampleRate: 44100,
            ossKey: "uploads/user-1/rec-1/test.mp3",
            tags: '["updated"]',
            notes: "Updated notes",
            aiSummary: null,
            recordedAt: null,
            status: "completed",
            createdAt: 1700000000000,
            updatedAt: 1700000001000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const rec = await recordingsRepo.findById("rec-1");
      expect(rec!.title).toBe("Updated Title");
      expect(rec!.description).toBe("New desc");
      expect(rec!.status).toBe("completed");
      expect(rec!.notes).toBe("Updated notes");
    });

    test("upserts existing settings", async () => {
      await seedUser();
      await settingsRepo.upsert("user-1", "theme", "light");

      const backup = makeMinimalBackup({
        settings: [{ key: "theme", value: "dark", updatedAt: 1700000001000 }],
      });

      await importBackup("user-1", backup);

      const setting = await settingsRepo.findByKey("user-1", "theme");
      expect(setting!.value).toBe("dark");
    });

    test("replaces recording-tag associations on import", async () => {
      await seedUser();
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "tag1" });
      await tagsRepo.create({ id: "t-2", userId: "user-1", name: "tag2" });
      await tagsRepo.create({ id: "t-3", userId: "user-1", name: "tag3" });
      await recordingsRepo.create({
        id: "rec-1",
        userId: "user-1",
        title: "Test",
        description: null,
        fileName: "test.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-1/test.mp3",
        status: "uploaded",
      });

      // Set initial tags
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      expect((await tagsRepo.findTagIdsForRecording("rec-1")).sort()).toEqual(["t-1", "t-2"]);

      // Import replaces with different tags
      const backup = makeMinimalBackup({
        recordingTags: [
          { recordingId: "rec-1", tagId: "t-2" },
          { recordingId: "rec-1", tagId: "t-3" },
        ],
      });

      await importBackup("user-1", backup);

      const tagIds = await tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds.sort()).toEqual(["t-2", "t-3"]);
    });

    test("re-keys data to current user on import", async () => {
      await seedUser("user-1", "alice@test.com");
      await seedUser("user-2", "bob@test.com");

      // Create backup pretending to be from user-2
      const backup = makeMinimalBackup({
        user: {
          id: "user-2",
          email: "bob@test.com",
          name: "Bob",
          avatarUrl: null,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        folders: [
          {
            id: "f-from-bob",
            name: "Bob Folder",
            icon: "folder",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        settings: [
          { key: "imported-key", value: "imported-val", updatedAt: 1700000000000 },
        ],
      });

      // Import as user-1
      await importBackup("user-1", backup);

      // Folder should belong to user-1, not user-2
      const folder = await foldersRepo.findById("f-from-bob");
      expect(folder).toBeDefined();
      expect(folder!.userId).toBe("user-1");

      // Settings should belong to user-1
      const setting = await settingsRepo.findByKey("user-1", "imported-key");
      expect(setting).toBeDefined();
      expect(setting!.value).toBe("imported-val");

      // user-2 should have nothing
      expect(await settingsRepo.findByKey("user-2", "imported-key")).toBeUndefined();
    });
  });

  // ── Full round-trip ──

  describe("round-trip export → import", () => {
    test("export then import into empty DB preserves all data", async () => {
      const user = await seedUser();
      await seedFullData(user.id);

      // Export
      const backup = await exportBackup(user);

      // Clear DB
      resetDb();
      await seedUser();

      // Import
      const counts = await importBackup("user-1", backup);

      expect(counts.folders).toBe(1);
      expect(counts.tags).toBe(2);
      expect(counts.recordings).toBe(2);
      expect(counts.transcriptionJobs).toBe(1);
      expect(counts.transcriptions).toBe(1);
      expect(counts.recordingTags).toBe(2);
      expect(counts.deviceTokens).toBe(1);
      expect(counts.settings).toBe(2);

      // Verify data integrity
      const folder = await foldersRepo.findById("f-1");
      expect(folder!.name).toBe("Work");

      const rec = await recordingsRepo.findById("rec-1");
      expect(rec!.title).toBe("Standup Call");
      expect(rec!.folderId).toBe("f-1");
      expect(rec!.notes).toBe("Good discussion");

      const tagIds = await tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds.sort()).toEqual(["t-1", "t-2"]);

      const job = await jobsRepo.findById("job-1");
      expect(job!.status).toBe("SUCCEEDED");

      const trans = await transcriptionsRepo.findByRecordingId("rec-1");
      expect(trans!.fullText).toContain("Hello team");

      const dt = await deviceTokensRepo.findById("dt-1");
      expect(dt!.name).toBe("MacBook");

      const aiProvider = await settingsRepo.findByKey("user-1", "ai.provider");
      expect(aiProvider!.value).toBe("openai");
    });

    test("export then re-import is idempotent (upsert same data)", async () => {
      const user = await seedUser();
      await seedFullData(user.id);

      const backup = await exportBackup(user);

      // Import on top of existing data (should upsert, not duplicate)
      const counts = await importBackup("user-1", backup);

      expect(counts.folders).toBe(1);
      expect(counts.recordings).toBe(2);

      // Verify no duplicates
      const allFolders = await foldersRepo.findByUserId("user-1");
      expect(allFolders).toHaveLength(1);

      const allRecordings = await recordingsRepo.findAll("user-1");
      expect(allRecordings).toHaveLength(2);

      const allTags = await tagsRepo.findByUserId("user-1");
      expect(allTags).toHaveLength(2);

      const allSettings = await settingsRepo.findByUserId("user-1");
      expect(allSettings).toHaveLength(2);
    });

    test("validates exported backup passes validation", async () => {
      const user = await seedUser();
      await seedFullData(user.id);

      const backup = await exportBackup(user);
      expect(validateBackup(backup)).toBeNull();
    });

    test("exported JSON can be serialized and deserialized", async () => {
      const user = await seedUser();
      await seedFullData(user.id);

      const backup = await exportBackup(user);
      const serialized = JSON.stringify(backup);
      const deserialized = JSON.parse(serialized);

      // Should pass validation after round-trip through JSON
      expect(validateBackup(deserialized)).toBeNull();

      // Clear and re-import
      resetDb();
      await seedUser();
      const counts = await importBackup("user-1", deserialized);
      expect(counts.recordings).toBe(2);
    });
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    test("import with only folders (no recordings)", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        folders: [
          {
            id: "f-only",
            name: "Lonely Folder",
            icon: "archive",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.folders).toBe(1);
      expect(counts.recordings).toBe(0);
    });

    test("import with only settings", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        settings: [
          { key: "k1", value: "v1", updatedAt: 1700000000000 },
          { key: "k2", value: "v2", updatedAt: 1700000000000 },
          { key: "k3", value: "v3", updatedAt: 1700000000000 },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.settings).toBe(3);

      const all = await settingsRepo.findByUserId("user-1");
      expect(all).toHaveLength(3);
    });

    test("import preserves null fields on recordings", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        recordings: [
          {
            id: "rec-nulls",
            folderId: null,
            title: "Null Fields",
            description: null,
            fileName: "test.mp3",
            fileSize: null,
            duration: null,
            format: null,
            sampleRate: null,
            ossKey: "uploads/user-1/rec-nulls/test.mp3",
            tags: "[]",
            notes: null,
            aiSummary: null,
            recordedAt: null,
            status: "uploaded",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const rec = await recordingsRepo.findById("rec-nulls");
      expect(rec!.description).toBeNull();
      expect(rec!.fileSize).toBeNull();
      expect(rec!.duration).toBeNull();
      expect(rec!.format).toBeNull();
      expect(rec!.sampleRate).toBeNull();
      expect(rec!.notes).toBeNull();
      expect(rec!.aiSummary).toBeNull();
      expect(rec!.recordedAt).toBeNull();
      expect(rec!.folderId).toBeNull();
    });

    test("import with device token null lastUsedAt", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        deviceTokens: [
          {
            id: "dt-null",
            name: "Never Used",
            tokenHash: "never-hash",
            lastUsedAt: null,
            createdAt: 1700000000000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const dt = await deviceTokensRepo.findById("dt-null");
      expect(dt!.lastUsedAt).toBeNull();
    });

    test("upserts existing device tokens", async () => {
      await seedUser();
      await deviceTokensRepo.create({
        id: "dt-1",
        userId: "user-1",
        name: "Old Name",
        tokenHash: "old-hash",
      });

      const backup = makeMinimalBackup({
        deviceTokens: [
          {
            id: "dt-1",
            name: "Updated Name",
            tokenHash: "new-hash",
            lastUsedAt: 1700000000000,
            createdAt: 1700000000000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const dt = await deviceTokensRepo.findById("dt-1");
      expect(dt!.name).toBe("Updated Name");
      expect(dt!.tokenHash).toBe("new-hash");
    });

    test("upserts existing transcription jobs", async () => {
      await seedUser();
      await recordingsRepo.create({
        id: "rec-1",
        userId: "user-1",
        title: "Test",
        description: null,
        fileName: "test.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-1/test.mp3",
        status: "completed",
      });
      await jobsRepo.create({
        id: "job-1",
        recordingId: "rec-1",
        taskId: "old-task",
        requestId: null,
        status: "PENDING",
      });

      const backup = makeMinimalBackup({
        transcriptionJobs: [
          {
            id: "job-1",
            recordingId: "rec-1",
            taskId: "updated-task",
            requestId: "req-updated",
            status: "SUCCEEDED",
            submitTime: "2026-01-01T00:00:00Z",
            endTime: "2026-01-01T00:01:00Z",
            usageSeconds: 60,
            errorMessage: null,
            resultUrl: null,
            createdAt: 1700000000000,
            updatedAt: 1700000001000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const job = await jobsRepo.findById("job-1");
      expect(job!.taskId).toBe("updated-task");
      expect(job!.status).toBe("SUCCEEDED");
      expect(job!.requestId).toBe("req-updated");
    });

    test("upserts existing transcriptions", async () => {
      await seedUser();
      await recordingsRepo.create({
        id: "rec-1",
        userId: "user-1",
        title: "Test",
        description: null,
        fileName: "test.mp3",
        fileSize: 100,
        duration: 10,
        format: "mp3",
        sampleRate: 44100,
        ossKey: "uploads/user-1/rec-1/test.mp3",
        status: "completed",
      });
      await jobsRepo.create({
        id: "job-1",
        recordingId: "rec-1",
        taskId: "task-1",
        requestId: null,
        status: "SUCCEEDED",
      });
      await transcriptionsRepo.create({
        id: "trans-1",
        recordingId: "rec-1",
        jobId: "job-1",
        fullText: "Old text",
        sentences: [],
        language: "en",
      });

      const backup = makeMinimalBackup({
        transcriptions: [
          {
            id: "trans-1",
            recordingId: "rec-1",
            jobId: "job-1",
            fullText: "Updated text",
            sentences: "[]",
            language: "zh",
            createdAt: 1700000000000,
            updatedAt: 1700000001000,
          },
        ],
      });

      await importBackup("user-1", backup);

      const trans = await transcriptionsRepo.findById("trans-1");
      expect(trans!.fullText).toBe("Updated text");
      expect(trans!.language).toBe("zh");
    });

    test("import multiple recordings with interleaved data", async () => {
      await seedUser();
      const backup = makeMinimalBackup({
        tags: [
          { id: "t-a", name: "alpha", createdAt: 1700000000000 },
          { id: "t-b", name: "beta", createdAt: 1700000000000 },
        ],
        recordings: [
          {
            id: "rec-a",
            folderId: null,
            title: "Alpha",
            description: null,
            fileName: "a.mp3",
            fileSize: 100,
            duration: 10,
            format: "mp3",
            sampleRate: 44100,
            ossKey: "uploads/user-1/rec-a/a.mp3",
            tags: "[]",
            notes: null,
            aiSummary: null,
            recordedAt: null,
            status: "uploaded",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
          {
            id: "rec-b",
            folderId: null,
            title: "Beta",
            description: null,
            fileName: "b.mp3",
            fileSize: 200,
            duration: 20,
            format: "mp3",
            sampleRate: 44100,
            ossKey: "uploads/user-1/rec-b/b.mp3",
            tags: "[]",
            notes: null,
            aiSummary: null,
            recordedAt: null,
            status: "completed",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        transcriptionJobs: [
          {
            id: "job-a",
            recordingId: "rec-a",
            taskId: "task-a",
            requestId: null,
            status: "SUCCEEDED",
            submitTime: null,
            endTime: null,
            usageSeconds: null,
            errorMessage: null,
            resultUrl: null,
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
          {
            id: "job-b",
            recordingId: "rec-b",
            taskId: "task-b",
            requestId: null,
            status: "FAILED",
            submitTime: null,
            endTime: null,
            usageSeconds: null,
            errorMessage: "Timeout",
            resultUrl: null,
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        recordingTags: [
          { recordingId: "rec-a", tagId: "t-a" },
          { recordingId: "rec-b", tagId: "t-b" },
        ],
      });

      const counts = await importBackup("user-1", backup);
      expect(counts.recordings).toBe(2);
      expect(counts.transcriptionJobs).toBe(2);
      expect(counts.recordingTags).toBe(2);

      expect(await tagsRepo.findTagIdsForRecording("rec-a")).toEqual(["t-a"]);
      expect(await tagsRepo.findTagIdsForRecording("rec-b")).toEqual(["t-b"]);

      const failedJob = await jobsRepo.findById("job-b");
      expect(failedJob!.errorMessage).toBe("Timeout");
    });
  });
});

// ── Push to Backy ──

describe("pushBackupToBacky", () => {
  const originalFetch = globalThis.fetch;
  const testCredentials = {
    webhookUrl: "https://backy.example.com/api/webhook/test-id",
    apiKey: "test-api-key-12345",
  };

  beforeEach(async () => {
    resetDb();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
  });

  test("sends multipart POST with correct fields and auth header", async () => {
    const user = await seedUser();
    await seedFullData(user.id);

    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedInit = init;
      return new Response(JSON.stringify({ id: "backup-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await pushBackupToBacky(user, testCredentials);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "backup-123" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify request metadata
    expect(result.request.url).toBe(testCredentials.webhookUrl);
    expect(result.request.method).toBe("POST");
    expect(result.request.environment).toBe("dev");
    expect(result.request.tag).toMatch(/^v\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}-\d+rec-\d+tr-\d+fld-\d+tag$/);
    expect(result.request.fileName).toMatch(/^lyre-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(result.request.fileSizeBytes).toBeGreaterThan(0);
    expect(result.request.backupStats.recordings).toBe(2);
    expect(result.request.backupStats.transcriptions).toBe(1);
    expect(result.request.backupStats.folders).toBe(1);
    expect(result.request.backupStats.tags).toBe(2);

    // Verify URL
    expect(capturedUrl).toBe(testCredentials.webhookUrl);

    // Verify auth header
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${testCredentials.apiKey}`);

    // Verify form data fields
    const body = capturedInit?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("environment")).toBe("dev"); // NODE_ENV=test → "dev"

    const tag = body.get("tag") as string;
    expect(tag).toMatch(/^v\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}-\d+rec-\d+tr-\d+fld-\d+tag$/);

    const file = body.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toMatch(/^lyre-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.type).toContain("application/json");

    // Verify backup content is valid
    const text = await file.text();
    const parsed = JSON.parse(text) as BackupData;
    expect(parsed.version).toBe(1);
    expect(parsed.user.email).toBe("alice@test.com");
    expect(parsed.recordings.length).toBe(2);
  });

  test("returns error details when Backy rejects", async () => {
    const user = await seedUser();

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await pushBackupToBacky(user, testCredentials);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "rate limited" });
    expect(result.request.environment).toBe("dev");
    expect(result.request.backupStats.recordings).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles non-JSON response from Backy", async () => {
    const user = await seedUser();

    globalThis.fetch = mock(async () => {
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    const result = await pushBackupToBacky(user, testCredentials);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    // Falls back to text body
    expect(result.body).toBe("Internal Server Error");
    expect(result.request).toBeDefined();
  });

  test("tag includes correct stats from backup data", async () => {
    const user = await seedUser();
    // No data seeded — empty backup

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await pushBackupToBacky(user, testCredentials);

    // Empty data: 0rec-0tr-0fld-0tag
    expect(result.request.tag).toContain("0rec-0tr-0fld-0tag");
    expect(result.request.backupStats).toEqual({
      recordings: 0,
      transcriptions: 0,
      folders: 0,
      tags: 0,
      jobs: 0,
      settings: 0,
    });
  });

  test("handles network-level fetch failure (DNS, TLS, connection refused)", async () => {
    const user = await seedUser();

    globalThis.fetch = mock(async () => {
      throw new Error("getaddrinfo ENOTFOUND backy.example.com");
    }) as unknown as typeof fetch;

    const result = await pushBackupToBacky(user, testCredentials);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.body).toEqual({
      fetchError: "getaddrinfo ENOTFOUND backy.example.com",
    });
    expect(result.request.url).toBe(testCredentials.webhookUrl);
    expect(result.request.method).toBe("POST");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles non-Error throw from fetch", async () => {
    const user = await seedUser();

    globalThis.fetch = mock(async () => {
      throw "connection timeout";
    }) as unknown as typeof fetch;

    const result = await pushBackupToBacky(user, testCredentials);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.body).toEqual({ fetchError: "connection timeout" });
  });
});
