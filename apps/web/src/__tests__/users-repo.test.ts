import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";

// Helper to create a test user
function makeUser(overrides?: Partial<Parameters<typeof usersRepo.create>[0]>) {
  return {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    avatarUrl: "https://example.com/alice.png",
    ...overrides,
  };
}

describe("usersRepo", () => {
  beforeEach(() => {
    resetDb();
  });

  describe("create", () => {
    test("creates a user and returns it", () => {
      const user = usersRepo.create(makeUser());
      expect(user.id).toBe("user-1");
      expect(user.email).toBe("alice@example.com");
      expect(user.name).toBe("Alice");
      expect(user.avatarUrl).toBe("https://example.com/alice.png");
      expect(user.createdAt).toBeGreaterThan(0);
      expect(user.updatedAt).toBeGreaterThan(0);
    });

    test("sets createdAt and updatedAt to current time", () => {
      const before = Date.now();
      const user = usersRepo.create(makeUser());
      const after = Date.now();
      expect(user.createdAt).toBeGreaterThanOrEqual(before);
      expect(user.createdAt).toBeLessThanOrEqual(after);
      expect(user.updatedAt).toBe(user.createdAt);
    });

    test("allows null name and avatarUrl", () => {
      const user = usersRepo.create(makeUser({ name: null, avatarUrl: null }));
      expect(user.name).toBeNull();
      expect(user.avatarUrl).toBeNull();
    });
  });

  describe("findAll", () => {
    test("returns empty array when no users", () => {
      expect(usersRepo.findAll()).toEqual([]);
    });

    test("returns all users", () => {
      usersRepo.create(makeUser({ id: "u1", email: "a@test.com" }));
      usersRepo.create(makeUser({ id: "u2", email: "b@test.com" }));
      expect(usersRepo.findAll()).toHaveLength(2);
    });
  });

  describe("findById", () => {
    test("returns user when found", () => {
      usersRepo.create(makeUser());
      const found = usersRepo.findById("user-1");
      expect(found?.email).toBe("alice@example.com");
    });

    test("returns undefined when not found", () => {
      expect(usersRepo.findById("nonexistent")).toBeUndefined();
    });
  });

  describe("findByEmail", () => {
    test("returns user when found", () => {
      usersRepo.create(makeUser());
      const found = usersRepo.findByEmail("alice@example.com");
      expect(found?.id).toBe("user-1");
    });

    test("returns undefined when not found", () => {
      expect(usersRepo.findByEmail("nobody@test.com")).toBeUndefined();
    });
  });

  describe("update", () => {
    test("updates name and returns updated user", () => {
      usersRepo.create(makeUser());
      const updated = usersRepo.update("user-1", { name: "Alice Updated" });
      expect(updated?.name).toBe("Alice Updated");
      expect(updated?.email).toBe("alice@example.com");
    });

    test("updates avatarUrl", () => {
      usersRepo.create(makeUser());
      const updated = usersRepo.update("user-1", {
        avatarUrl: "https://example.com/new.png",
      });
      expect(updated?.avatarUrl).toBe("https://example.com/new.png");
    });

    test("updates updatedAt timestamp", () => {
      const user = usersRepo.create(makeUser());
      // Small delay to ensure different timestamp
      const updated = usersRepo.update("user-1", { name: "New" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(user.updatedAt);
    });

    test("returns undefined when user not found", () => {
      const updated = usersRepo.update("nonexistent", { name: "X" });
      expect(updated).toBeUndefined();
    });
  });

  describe("upsertByEmail", () => {
    test("creates user if not existing", () => {
      const user = usersRepo.upsertByEmail(makeUser());
      expect(user.id).toBe("user-1");
      expect(user.email).toBe("alice@example.com");
    });

    test("updates existing user by email", () => {
      usersRepo.create(makeUser());
      const updated = usersRepo.upsertByEmail({
        id: "user-new",
        email: "alice@example.com",
        name: "Alice V2",
        avatarUrl: "https://example.com/v2.png",
      });
      // Should keep original id
      expect(updated.id).toBe("user-1");
      expect(updated.name).toBe("Alice V2");
      expect(updated.avatarUrl).toBe("https://example.com/v2.png");
    });

    test("does not create duplicate entries", () => {
      usersRepo.upsertByEmail(makeUser());
      usersRepo.upsertByEmail({
        ...makeUser(),
        name: "Updated",
      });
      expect(usersRepo.findAll()).toHaveLength(1);
    });
  });

  describe("delete", () => {
    test("deletes existing user and returns true", () => {
      usersRepo.create(makeUser());
      expect(usersRepo.delete("user-1")).toBe(true);
      expect(usersRepo.findById("user-1")).toBeUndefined();
    });

    test("returns false when user not found", () => {
      expect(usersRepo.delete("nonexistent")).toBe(false);
    });
  });
});
