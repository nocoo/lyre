import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { foldersRepo } from "@lyre/api/db/repositories/folders";

async function seedUser() {
  return await usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

describe("foldersRepo", () => {
  beforeEach(async () => {
    resetDb();
    await seedUser();
  });

  describe("create", () => {
    test("creates a folder with defaults", async () => {
      const folder = await foldersRepo.create({
        id: "f-1",
        userId: "user-1",
        name: "Meetings",
      });
      expect(folder.id).toBe("f-1");
      expect(folder.name).toBe("Meetings");
      expect(folder.icon).toBe("folder");
      expect(folder.createdAt).toBeGreaterThan(0);
    });

    test("creates a folder with custom icon", async () => {
      const folder = await foldersRepo.create({
        id: "f-1",
        userId: "user-1",
        name: "Podcasts",
        icon: "mic",
      });
      expect(folder.icon).toBe("mic");
    });
  });

  describe("findByUserId", () => {
    test("returns all folders for user", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "A" });
      await foldersRepo.create({ id: "f-2", userId: "user-1", name: "B" });
      const folders = await foldersRepo.findByUserId("user-1");
      expect(folders).toHaveLength(2);
    });

    test("returns empty for different user", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "A" });
      expect(await foldersRepo.findByUserId("user-other")).toEqual([]);
    });
  });

  describe("findById", () => {
    test("returns folder when found", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect((await foldersRepo.findById("f-1"))?.name).toBe("Test");
    });

    test("returns undefined when not found", async () => {
      expect(await foldersRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByIdAndUser", () => {
    test("returns folder for correct user", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect((await foldersRepo.findByIdAndUser("f-1", "user-1"))?.name).toBe("Test");
    });

    test("returns undefined for wrong user", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect(await foldersRepo.findByIdAndUser("f-1", "user-other")).toBeUndefined();
    });
  });

  describe("update", () => {
    test("updates name", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Old" });
      const updated = await foldersRepo.update("f-1", { name: "New" });
      expect(updated?.name).toBe("New");
    });

    test("updates icon", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      const updated = await foldersRepo.update("f-1", { icon: "star" });
      expect(updated?.icon).toBe("star");
    });

    test("updates updatedAt", async () => {
      const folder = await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      const updated = await foldersRepo.update("f-1", { name: "New" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(folder.updatedAt);
    });

    test("returns undefined when not found", async () => {
      expect(await foldersRepo.update("nope", { name: "X" })).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing folder", async () => {
      await foldersRepo.create({ id: "f-1", userId: "user-1", name: "Test" });
      expect(await foldersRepo.delete("f-1")).toBe(true);
      expect(await foldersRepo.findById("f-1")).toBeUndefined();
    });

    test("returns false when not found", async () => {
      expect(await foldersRepo.delete("nope")).toBe(false);
    });
  });
});
