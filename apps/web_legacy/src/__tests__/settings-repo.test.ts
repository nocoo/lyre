import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { settingsRepo } from "@/db/repositories/settings";

function seedUser() {
  usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

describe("settingsRepo", () => {
  beforeEach(() => {
    resetDb();
    seedUser();
  });

  describe("upsert", () => {
    test("creates a new setting", () => {
      const s = settingsRepo.upsert("user-1", "theme", "dark");
      expect(s.userId).toBe("user-1");
      expect(s.key).toBe("theme");
      expect(s.value).toBe("dark");
      expect(s.updatedAt).toBeGreaterThan(0);
    });

    test("updates an existing setting", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      const updated = settingsRepo.upsert("user-1", "theme", "light");
      expect(updated.value).toBe("light");
    });

    test("does not create duplicates on upsert", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      settingsRepo.upsert("user-1", "theme", "light");
      const all = settingsRepo.findByUserId("user-1");
      const themeSettings = all.filter((s) => s.key === "theme");
      expect(themeSettings).toHaveLength(1);
    });
  });

  describe("findByUserId", () => {
    test("returns all settings for user", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      settingsRepo.upsert("user-1", "language", "en");
      settingsRepo.upsert("user-1", "notifications", "true");
      const all = settingsRepo.findByUserId("user-1");
      expect(all).toHaveLength(3);
    });

    test("returns empty for unknown user", () => {
      expect(settingsRepo.findByUserId("nobody")).toEqual([]);
    });
  });

  describe("findByKey", () => {
    test("returns setting when found", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      const found = settingsRepo.findByKey("user-1", "theme");
      expect(found?.value).toBe("dark");
    });

    test("returns undefined when key not found", () => {
      expect(settingsRepo.findByKey("user-1", "nope")).toBeUndefined();
    });

    test("returns undefined when user not found", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      expect(settingsRepo.findByKey("nobody", "theme")).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing setting", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      expect(settingsRepo.delete("user-1", "theme")).toBe(true);
      expect(settingsRepo.findByKey("user-1", "theme")).toBeUndefined();
    });

    test("returns false when not found", () => {
      expect(settingsRepo.delete("user-1", "nope")).toBe(false);
    });
  });

  describe("deleteByUserId", () => {
    test("deletes all settings for user", () => {
      settingsRepo.upsert("user-1", "theme", "dark");
      settingsRepo.upsert("user-1", "lang", "en");
      const deleted = settingsRepo.deleteByUserId("user-1");
      expect(deleted).toBe(2);
      expect(settingsRepo.findByUserId("user-1")).toEqual([]);
    });

    test("returns 0 when no settings for user", () => {
      expect(settingsRepo.deleteByUserId("nobody")).toBe(0);
    });
  });

  describe("findByKeyAndValue", () => {
    test("returns setting when key and value match", () => {
      settingsRepo.upsert("user-1", "backy.pullKey", "secret-key-123");
      const found = settingsRepo.findByKeyAndValue("backy.pullKey", "secret-key-123");
      expect(found).toBeDefined();
      expect(found!.userId).toBe("user-1");
    });

    test("returns undefined when key matches but value differs", () => {
      settingsRepo.upsert("user-1", "backy.pullKey", "real-key");
      expect(settingsRepo.findByKeyAndValue("backy.pullKey", "wrong-key")).toBeUndefined();
    });

    test("returns undefined when value matches but key differs", () => {
      settingsRepo.upsert("user-1", "backy.apiKey", "some-value");
      expect(settingsRepo.findByKeyAndValue("backy.pullKey", "some-value")).toBeUndefined();
    });

    test("returns undefined when no settings exist", () => {
      expect(settingsRepo.findByKeyAndValue("backy.pullKey", "any")).toBeUndefined();
    });

    test("finds correct user among multiple users", () => {
      usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      settingsRepo.upsert("user-1", "backy.pullKey", "alice-key");
      settingsRepo.upsert("user-2", "backy.pullKey", "bob-key");

      const alice = settingsRepo.findByKeyAndValue("backy.pullKey", "alice-key");
      expect(alice?.userId).toBe("user-1");
      const bob = settingsRepo.findByKeyAndValue("backy.pullKey", "bob-key");
      expect(bob?.userId).toBe("user-2");
    });
  });
});
