import { describe, expect, test, beforeEach } from "bun:test";
import { createHash } from "crypto";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { deviceTokensRepo } from "@/db/repositories/device-tokens";

function seedUser() {
  usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("deviceTokensRepo", () => {
  beforeEach(() => {
    resetDb();
    seedUser();
  });

  describe("create", () => {
    test("creates a new token record", () => {
      const hash = hashToken("test-token-raw");
      const token = deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "MacBook Pro",
        tokenHash: hash,
      });
      expect(token.id).toBe("tok-1");
      expect(token.userId).toBe("user-1");
      expect(token.name).toBe("MacBook Pro");
      expect(token.tokenHash).toBe(hash);
      expect(token.lastUsedAt).toBeNull();
      expect(token.createdAt).toBeGreaterThan(0);
    });

    test("rejects duplicate token hash", () => {
      const hash = hashToken("same-token");
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device A",
        tokenHash: hash,
      });
      expect(() =>
        deviceTokensRepo.create({
          id: "tok-2",
          userId: "user-1",
          name: "Device B",
          tokenHash: hash,
        }),
      ).toThrow();
    });
  });

  describe("findByHash", () => {
    test("returns token when hash matches", () => {
      const hash = hashToken("lookup-token");
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "My Mac",
        tokenHash: hash,
      });
      const found = deviceTokensRepo.findByHash(hash);
      expect(found?.id).toBe("tok-1");
      expect(found?.name).toBe("My Mac");
    });

    test("returns undefined for unknown hash", () => {
      expect(deviceTokensRepo.findByHash("nonexistent")).toBeUndefined();
    });
  });

  describe("findById", () => {
    test("returns token when found", () => {
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device",
        tokenHash: hashToken("t1"),
      });
      const found = deviceTokensRepo.findById("tok-1");
      expect(found?.name).toBe("Device");
    });

    test("returns undefined for unknown id", () => {
      expect(deviceTokensRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByUserId", () => {
    test("returns all tokens for a user", () => {
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device A",
        tokenHash: hashToken("a"),
      });
      deviceTokensRepo.create({
        id: "tok-2",
        userId: "user-1",
        name: "Device B",
        tokenHash: hashToken("b"),
      });
      const tokens = deviceTokensRepo.findByUserId("user-1");
      expect(tokens).toHaveLength(2);
    });

    test("returns empty for unknown user", () => {
      expect(deviceTokensRepo.findByUserId("nobody")).toEqual([]);
    });

    test("does not return tokens from other users", () => {
      usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Alice Device",
        tokenHash: hashToken("alice"),
      });
      deviceTokensRepo.create({
        id: "tok-2",
        userId: "user-2",
        name: "Bob Device",
        tokenHash: hashToken("bob"),
      });
      const tokens = deviceTokensRepo.findByUserId("user-1");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe("Alice Device");
    });
  });

  describe("touchLastUsed", () => {
    test("updates lastUsedAt timestamp", () => {
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device",
        tokenHash: hashToken("t"),
      });
      const before = deviceTokensRepo.findById("tok-1");
      expect(before?.lastUsedAt).toBeNull();

      deviceTokensRepo.touchLastUsed("tok-1");

      const after = deviceTokensRepo.findById("tok-1");
      expect(after?.lastUsedAt).toBeGreaterThan(0);
    });
  });

  describe("deleteByIdAndUser", () => {
    test("deletes token owned by user", () => {
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device",
        tokenHash: hashToken("t"),
      });
      expect(deviceTokensRepo.deleteByIdAndUser("tok-1", "user-1")).toBe(true);
      expect(deviceTokensRepo.findById("tok-1")).toBeUndefined();
    });

    test("does not delete token owned by another user", () => {
      usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-2",
        name: "Bob Device",
        tokenHash: hashToken("bob"),
      });
      // user-1 tries to delete user-2's token
      expect(deviceTokensRepo.deleteByIdAndUser("tok-1", "user-1")).toBe(false);
      expect(deviceTokensRepo.findById("tok-1")).toBeDefined();
    });

    test("returns false for nonexistent token", () => {
      expect(deviceTokensRepo.deleteByIdAndUser("nope", "user-1")).toBe(false);
    });
  });

  describe("deleteByUserId", () => {
    test("deletes all tokens for user", () => {
      deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "A",
        tokenHash: hashToken("a"),
      });
      deviceTokensRepo.create({
        id: "tok-2",
        userId: "user-1",
        name: "B",
        tokenHash: hashToken("b"),
      });
      const deleted = deviceTokensRepo.deleteByUserId("user-1");
      expect(deleted).toBe(2);
      expect(deviceTokensRepo.findByUserId("user-1")).toEqual([]);
    });

    test("returns 0 when no tokens for user", () => {
      expect(deviceTokensRepo.deleteByUserId("nobody")).toBe(0);
    });
  });
});
