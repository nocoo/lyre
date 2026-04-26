import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { tagsRepo } from "@lyre/api/db/repositories/tags";
import { recordingsRepo } from "@lyre/api/db/repositories/recordings";

async function seedUser() {
  return await usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

function makeRecording(id: string = "rec-1") {
  return {
    id,
    userId: "user-1",
    title: "Test Recording",
    description: null,
    fileName: "test.mp3",
    fileSize: 1024,
    duration: 60,
    format: "mp3",
    sampleRate: 44100,
    ossKey: `uploads/user-1/${id}/test.mp3`,
    tags: [] as string[],
    status: "uploaded" as const,
  };
}

describe("tagsRepo", () => {
  beforeEach(async () => {
    resetDb();
    await seedUser();
  });

  describe("create", () => {
    test("creates a tag", async () => {
      const tag = await tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      expect(tag.id).toBe("t-1");
      expect(tag.name).toBe("meeting");
      expect(tag.userId).toBe("user-1");
      expect(tag.createdAt).toBeGreaterThan(0);
    });
  });

  describe("findByUserId", () => {
    test("returns all tags for user", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "a" });
      await tagsRepo.create({ id: "t-2", userId: "user-1", name: "b" });
      const tags = await tagsRepo.findByUserId("user-1");
      expect(tags).toHaveLength(2);
    });

    test("returns empty for different user", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "a" });
      expect(await tagsRepo.findByUserId("user-other")).toEqual([]);
    });
  });

  describe("findById", () => {
    test("returns tag when found", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect((await tagsRepo.findById("t-1"))?.name).toBe("test");
    });

    test("returns undefined when not found", async () => {
      expect(await tagsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByIdAndUser", () => {
    test("returns tag for correct user", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect((await tagsRepo.findByIdAndUser("t-1", "user-1"))?.name).toBe("test");
    });

    test("returns undefined for wrong user", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect(await tagsRepo.findByIdAndUser("t-1", "user-other")).toBeUndefined();
    });
  });

  describe("findByNameAndUser", () => {
    test("finds tag by name", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      expect((await tagsRepo.findByNameAndUser("meeting", "user-1"))?.id).toBe("t-1");
    });

    test("returns undefined for different name", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      expect(await tagsRepo.findByNameAndUser("podcast", "user-1")).toBeUndefined();
    });

    test("is case-sensitive", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "Meeting" });
      expect(await tagsRepo.findByNameAndUser("meeting", "user-1")).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing tag", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect(await tagsRepo.delete("t-1")).toBe(true);
      expect(await tagsRepo.findById("t-1")).toBeUndefined();
    });

    test("returns false when not found", async () => {
      expect(await tagsRepo.delete("nope")).toBe(false);
    });
  });

  describe("update", () => {
    test("renames a tag", async () => {
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "old" });
      const updated = await tagsRepo.update("t-1", { name: "new" });
      expect(updated?.name).toBe("new");
      expect((await tagsRepo.findById("t-1"))?.name).toBe("new");
    });

    test("returns undefined for non-existent tag", async () => {
      expect(await tagsRepo.update("nope", { name: "whatever" })).toBeUndefined();
    });
  });

  describe("recording tag associations", () => {
    beforeEach(async () => {
      await recordingsRepo.create(makeRecording("rec-1"));
      await recordingsRepo.create(makeRecording("rec-2"));
      await tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      await tagsRepo.create({ id: "t-2", userId: "user-1", name: "podcast" });
      await tagsRepo.create({ id: "t-3", userId: "user-1", name: "draft" });
    });

    test("setTagsForRecording associates tags", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      const tagIds = await tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds).toHaveLength(2);
      expect(tagIds).toContain("t-1");
      expect(tagIds).toContain("t-2");
    });

    test("setTagsForRecording replaces existing associations", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      await tagsRepo.setTagsForRecording("rec-1", ["t-3"]);
      const tagIds = await tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds).toEqual(["t-3"]);
    });

    test("findTagsForRecording returns resolved tags", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      const tags = await tagsRepo.findTagsForRecording("rec-1");
      expect(tags).toHaveLength(2);
      expect(tags.map((t) => t.name).sort()).toEqual(["meeting", "podcast"]);
    });

    test("findTagsForRecording returns empty for untagged recording", async () => {
      expect(await tagsRepo.findTagsForRecording("rec-1")).toEqual([]);
    });

    test("clearTagsForRecording removes all associations", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      await tagsRepo.clearTagsForRecording("rec-1");
      expect(await tagsRepo.findTagIdsForRecording("rec-1")).toEqual([]);
    });

    test("associations are per-recording", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1"]);
      await tagsRepo.setTagsForRecording("rec-2", ["t-2"]);
      expect(await tagsRepo.findTagIdsForRecording("rec-1")).toEqual(["t-1"]);
      expect(await tagsRepo.findTagIdsForRecording("rec-2")).toEqual(["t-2"]);
    });

    test("deleting a tag cascades to recording_tags", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      await tagsRepo.delete("t-1");
      const tagIds = await tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds).toEqual(["t-2"]);
    });

    test("deleteCascade on recording cleans up tag associations", async () => {
      await tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      await recordingsRepo.deleteCascade("rec-1");
      // Tags themselves still exist
      expect(await tagsRepo.findById("t-1")).toBeDefined();
      expect(await tagsRepo.findById("t-2")).toBeDefined();
      // But associations are gone (recording deleted)
      expect(await tagsRepo.findTagIdsForRecording("rec-1")).toEqual([]);
    });
  });
});
