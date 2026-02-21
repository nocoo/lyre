import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { foldersRepo } from "@/db/repositories/folders";

function seedUser() {
  return usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

describe("foldersRepo", () => {
  beforeEach(() => {
    resetDb();
    seedUser();
  });

  describe("create", () => {
    test("creates a folder with defaults", () => {
      const folder = foldersRepo.create({
        id: "f-1",
        userId: "user-1",
        name: "Meetings",
      });
      expect(folder.id).toBe("f-1");
      expect(folder.name).toBe("Meetings");
      expect(folder.icon).toBe("folder");
      expect(folder.createdAt).toBeGreaterThan(0);
    });

    test("creates a folder with custom icon", () => {
      const folder = foldersRepo.create({
        id: "f-1",
        userId: "user-1",
        name: "Podcasts",
        icon: "mic",
      });
      expect(folder.icon).toBe("mic");
    });
  });

  describe("findByUserId", () => {
    test("returns all folders for user", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "A" });
      foldersRepo.create({ id: "f-2", userId: "user-1", name: "B" });
      const folders = foldersRepo.findByUserId("user-1");
      expect(folders).toHaveLength(2);
    });

    test("returns empty for different user", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "A" });
      expect(foldersRepo.findByUserId("user-other")).toEqual([]);
    });
  });

  describe("findById", () => {
    test("returns folder when found", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect(foldersRepo.findById("f-1")?.name).toBe("Test");
    });

    test("returns undefined when not found", () => {
      expect(foldersRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByIdAndUser", () => {
    test("returns folder for correct user", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect(foldersRepo.findByIdAndUser("f-1", "user-1")?.name).toBe("Test");
    });

    test("returns undefined for wrong user", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect(foldersRepo.findByIdAndUser("f-1", "user-other")).toBeUndefined();
    });
  });

  describe("update", () => {
    test("updates name", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "Old" });
      const updated = foldersRepo.update("f-1", { name: "New" });
      expect(updated?.name).toBe("New");
    });

    test("updates icon", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      const updated = foldersRepo.update("f-1", { icon: "star" });
      expect(updated?.icon).toBe("star");
    });

    test("updates updatedAt", () => {
      const folder = foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      const updated = foldersRepo.update("f-1", { name: "New" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(folder.updatedAt);
    });

    test("returns undefined when not found", () => {
      expect(foldersRepo.update("nope", { name: "X" })).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing folder", () => {
      foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect(foldersRepo.delete("f-1")).toBe(true);
      expect(foldersRepo.findById("f-1")).toBeUndefined();
    });

    test("returns false when not found", () => {
      expect(foldersRepo.delete("nope")).toBe(false);
    });
  });
});
