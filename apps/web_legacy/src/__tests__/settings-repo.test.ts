import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { settingsRepo } from "@lyre/api/db/repositories/settings";

async function seedUser() {
  await usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

describe("settingsRepo", () => {
  beforeEach(async () => {
    resetDb();
    await seedUser();
  });

  describe("upsert", () => {
    test("creates a new setting", async () => {
      const s = await settingsRepo.upsert("user-1", "theme", "dark");
      expect(s.userId).toBe("user-1");
      expect(s.key).toBe("theme");
      expect(s.value).toBe("dark");
      expect(s.updatedAt).toBeGreaterThan(0);
    });

    test("updates an existing setting", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      const updated = await settingsRepo.upsert("user-1", "theme", "light");
      expect(updated.value).toBe("light");
    });

    test("does not create duplicates on upsert", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      await settingsRepo.upsert("user-1", "theme", "light");
      const all = await settingsRepo.findByUserId("user-1");
      const themeSettings = all.filter((s) => s.key === "theme");
      expect(themeSettings).toHaveLength(1);
    });
  });

  describe("findByUserId", () => {
    test("returns all settings for user", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      await settingsRepo.upsert("user-1", "language", "en");
      await settingsRepo.upsert("user-1", "notifications", "true");
      const all = await settingsRepo.findByUserId("user-1");
      expect(all).toHaveLength(3);
    });

    test("returns empty for unknown user", async () => {
      expect(await settingsRepo.findByUserId("nobody")).toEqual([]);
    });
  });

  describe("findByKey", () => {
    test("returns setting when found", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      const found = await settingsRepo.findByKey("user-1", "theme");
      expect(found?.value).toBe("dark");
    });

    test("returns undefined when key not found", async () => {
      expect(await settingsRepo.findByKey("user-1", "nope")).toBeUndefined();
    });

    test("returns undefined when user not found", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      expect(await settingsRepo.findByKey("nobody", "theme")).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing setting", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      expect(await settingsRepo.delete("user-1", "theme")).toBe(true);
      expect(await settingsRepo.findByKey("user-1", "theme")).toBeUndefined();
    });

    test("returns false when not found", async () => {
      expect(await settingsRepo.delete("user-1", "nope")).toBe(false);
    });
  });

  describe("deleteByUserId", () => {
    test("deletes all settings for user", async () => {
      await settingsRepo.upsert("user-1", "theme", "dark");
      await settingsRepo.upsert("user-1", "lang", "en");
      const deleted = await settingsRepo.deleteByUserId("user-1");
      expect(deleted).toBe(2);
      expect(await settingsRepo.findByUserId("user-1")).toEqual([]);
    });

    test("returns 0 when no settings for user", async () => {
      expect(await settingsRepo.deleteByUserId("nobody")).toBe(0);
    });
  });

  describe("findByKeyAndValue", () => {
    test("returns setting when key and value match", async () => {
      await settingsRepo.upsert("user-1", "backy.pullKey", "secret-key-123");
      const found = await settingsRepo.findByKeyAndValue("backy.pullKey", "secret-key-123");
      expect(found).toBeDefined();
      expect(found!.userId).toBe("user-1");
    });

    test("returns undefined when key matches but value differs", async () => {
      await settingsRepo.upsert("user-1", "backy.pullKey", "real-key");
      expect(await settingsRepo.findByKeyAndValue("backy.pullKey", "wrong-key")).toBeUndefined();
    });

    test("returns undefined when value matches but key differs", async () => {
      await settingsRepo.upsert("user-1", "backy.apiKey", "some-value");
      expect(await settingsRepo.findByKeyAndValue("backy.pullKey", "some-value")).toBeUndefined();
    });

    test("returns undefined when no settings exist", async () => {
      expect(await settingsRepo.findByKeyAndValue("backy.pullKey", "any")).toBeUndefined();
    });

    test("finds correct user among multiple users", async () => {
      await usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      await settingsRepo.upsert("user-1", "backy.pullKey", "alice-key");
      await settingsRepo.upsert("user-2", "backy.pullKey", "bob-key");

      const alice = await settingsRepo.findByKeyAndValue("backy.pullKey", "alice-key");
      expect(alice?.userId).toBe("user-1");
      const bob = await settingsRepo.findByKeyAndValue("backy.pullKey", "bob-key");
      expect(bob?.userId).toBe("user-2");
    });
  });
});
