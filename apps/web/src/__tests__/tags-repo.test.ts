import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { tagsRepo } from "@/db/repositories/tags";
import { recordingsRepo } from "@/db/repositories/recordings";

function seedUser() {
  return usersRepo.create({
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
  beforeEach(() => {
    resetDb();
    seedUser();
  });

  describe("create", () => {
    test("creates a tag", () => {
      const tag = tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      expect(tag.id).toBe("t-1");
      expect(tag.name).toBe("meeting");
      expect(tag.userId).toBe("user-1");
      expect(tag.createdAt).toBeGreaterThan(0);
    });
  });

  describe("findByUserId", () => {
    test("returns all tags for user", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "a" });
      tagsRepo.create({ id: "t-2", userId: "user-1", name: "b" });
      const tags = tagsRepo.findByUserId("user-1");
      expect(tags).toHaveLength(2);
    });

    test("returns empty for different user", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "a" });
      expect(tagsRepo.findByUserId("user-other")).toEqual([]);
    });
  });

  describe("findById", () => {
    test("returns tag when found", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect(tagsRepo.findById("t-1")?.name).toBe("test");
    });

    test("returns undefined when not found", () => {
      expect(tagsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByIdAndUser", () => {
    test("returns tag for correct user", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect(tagsRepo.findByIdAndUser("t-1", "user-1")?.name).toBe("test");
    });

    test("returns undefined for wrong user", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect(tagsRepo.findByIdAndUser("t-1", "user-other")).toBeUndefined();
    });
  });

  describe("findByNameAndUser", () => {
    test("finds tag by name", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      expect(tagsRepo.findByNameAndUser("meeting", "user-1")?.id).toBe("t-1");
    });

    test("returns undefined for different name", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      expect(tagsRepo.findByNameAndUser("podcast", "user-1")).toBeUndefined();
    });

    test("is case-sensitive", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "Meeting" });
      expect(tagsRepo.findByNameAndUser("meeting", "user-1")).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing tag", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "test" });
      expect(tagsRepo.delete("t-1")).toBe(true);
      expect(tagsRepo.findById("t-1")).toBeUndefined();
    });

    test("returns false when not found", () => {
      expect(tagsRepo.delete("nope")).toBe(false);
    });
  });

  describe("update", () => {
    test("renames a tag", () => {
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "old" });
      const updated = tagsRepo.update("t-1", { name: "new" });
      expect(updated?.name).toBe("new");
      expect(tagsRepo.findById("t-1")?.name).toBe("new");
    });

    test("returns undefined for non-existent tag", () => {
      expect(tagsRepo.update("nope", { name: "whatever" })).toBeUndefined();
    });
  });

  describe("recording tag associations", () => {
    beforeEach(() => {
      recordingsRepo.create(makeRecording("rec-1"));
      recordingsRepo.create(makeRecording("rec-2"));
      tagsRepo.create({ id: "t-1", userId: "user-1", name: "meeting" });
      tagsRepo.create({ id: "t-2", userId: "user-1", name: "podcast" });
      tagsRepo.create({ id: "t-3", userId: "user-1", name: "draft" });
    });

    test("setTagsForRecording associates tags", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      const tagIds = tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds).toHaveLength(2);
      expect(tagIds).toContain("t-1");
      expect(tagIds).toContain("t-2");
    });

    test("setTagsForRecording replaces existing associations", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      tagsRepo.setTagsForRecording("rec-1", ["t-3"]);
      const tagIds = tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds).toEqual(["t-3"]);
    });

    test("findTagsForRecording returns resolved tags", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      const tags = tagsRepo.findTagsForRecording("rec-1");
      expect(tags).toHaveLength(2);
      expect(tags.map((t) => t.name).sort()).toEqual(["meeting", "podcast"]);
    });

    test("findTagsForRecording returns empty for untagged recording", () => {
      expect(tagsRepo.findTagsForRecording("rec-1")).toEqual([]);
    });

    test("clearTagsForRecording removes all associations", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      tagsRepo.clearTagsForRecording("rec-1");
      expect(tagsRepo.findTagIdsForRecording("rec-1")).toEqual([]);
    });

    test("associations are per-recording", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1"]);
      tagsRepo.setTagsForRecording("rec-2", ["t-2"]);
      expect(tagsRepo.findTagIdsForRecording("rec-1")).toEqual(["t-1"]);
      expect(tagsRepo.findTagIdsForRecording("rec-2")).toEqual(["t-2"]);
    });

    test("deleting a tag cascades to recording_tags", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      tagsRepo.delete("t-1");
      const tagIds = tagsRepo.findTagIdsForRecording("rec-1");
      expect(tagIds).toEqual(["t-2"]);
    });

    test("deleteCascade on recording cleans up tag associations", () => {
      tagsRepo.setTagsForRecording("rec-1", ["t-1", "t-2"]);
      recordingsRepo.deleteCascade("rec-1");
      // Tags themselves still exist
      expect(tagsRepo.findById("t-1")).toBeDefined();
      expect(tagsRepo.findById("t-2")).toBeDefined();
      // But associations are gone (recording deleted)
      expect(tagsRepo.findTagIdsForRecording("rec-1")).toEqual([]);
    });
  });
});
