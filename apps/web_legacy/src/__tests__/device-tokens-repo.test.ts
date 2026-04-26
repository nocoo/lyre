import { describe, expect, test, beforeEach } from "bun:test";
import { createHash } from "crypto";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { deviceTokensRepo } from "@lyre/api/db/repositories/device-tokens";

async function seedUser() {
  await usersRepo.create({
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
  beforeEach(async () => {
    resetDb();
    await seedUser();
  });

  describe("create", () => {
    test("creates a new token record", async () => {
      const hash = hashToken("test-token-raw");
      const token = await deviceTokensRepo.create({
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

    test("rejects duplicate token hash", async () => {
      const hash = hashToken("same-token");
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device A",
        tokenHash: hash,
      });
      await expect(
        deviceTokensRepo.create({
          id: "tok-2",
          userId: "user-1",
          name: "Device B",
          tokenHash: hash,
        }),
      ).rejects.toThrow();
    });
  });

  describe("findByHash", () => {
    test("returns token when hash matches", async () => {
      const hash = hashToken("lookup-token");
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "My Mac",
        tokenHash: hash,
      });
      const found = await deviceTokensRepo.findByHash(hash);
      expect(found?.id).toBe("tok-1");
      expect(found?.name).toBe("My Mac");
    });

    test("returns undefined for unknown hash", async () => {
      expect(await deviceTokensRepo.findByHash("nonexistent")).toBeUndefined();
    });
  });

  describe("findById", () => {
    test("returns token when found", async () => {
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device",
        tokenHash: hashToken("t1"),
      });
      const found = await deviceTokensRepo.findById("tok-1");
      expect(found?.name).toBe("Device");
    });

    test("returns undefined for unknown id", async () => {
      expect(await deviceTokensRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByUserId", () => {
    test("returns all tokens for a user", async () => {
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device A",
        tokenHash: hashToken("a"),
      });
      await deviceTokensRepo.create({
        id: "tok-2",
        userId: "user-1",
        name: "Device B",
        tokenHash: hashToken("b"),
      });
      const tokens = await deviceTokensRepo.findByUserId("user-1");
      expect(tokens).toHaveLength(2);
    });

    test("returns empty for unknown user", async () => {
      expect(await deviceTokensRepo.findByUserId("nobody")).toEqual([]);
    });

    test("does not return tokens from other users", async () => {
      await usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Alice Device",
        tokenHash: hashToken("alice"),
      });
      await deviceTokensRepo.create({
        id: "tok-2",
        userId: "user-2",
        name: "Bob Device",
        tokenHash: hashToken("bob"),
      });
      const tokens = await deviceTokensRepo.findByUserId("user-1");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.name).toBe("Alice Device");
    });
  });

  describe("touchLastUsed", () => {
    test("updates lastUsedAt timestamp", async () => {
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device",
        tokenHash: hashToken("t"),
      });
      const before = await deviceTokensRepo.findById("tok-1");
      expect(before?.lastUsedAt).toBeNull();

      await deviceTokensRepo.touchLastUsed("tok-1");

      const after = await deviceTokensRepo.findById("tok-1");
      expect(after?.lastUsedAt).toBeGreaterThan(0);
    });
  });

  describe("deleteByIdAndUser", () => {
    test("deletes token owned by user", async () => {
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "Device",
        tokenHash: hashToken("t"),
      });
      expect(await deviceTokensRepo.deleteByIdAndUser("tok-1", "user-1")).toBe(true);
      expect(await deviceTokensRepo.findById("tok-1")).toBeUndefined();
    });

    test("does not delete token owned by another user", async () => {
      await usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-2",
        name: "Bob Device",
        tokenHash: hashToken("bob"),
      });
      // user-1 tries to delete user-2's token
      expect(await deviceTokensRepo.deleteByIdAndUser("tok-1", "user-1")).toBe(false);
      expect(await deviceTokensRepo.findById("tok-1")).toBeDefined();
    });

    test("returns false for nonexistent token", async () => {
      expect(await deviceTokensRepo.deleteByIdAndUser("nope", "user-1")).toBe(false);
    });
  });

  describe("deleteByUserId", () => {
    test("deletes all tokens for user", async () => {
      await deviceTokensRepo.create({
        id: "tok-1",
        userId: "user-1",
        name: "A",
        tokenHash: hashToken("a"),
      });
      await deviceTokensRepo.create({
        id: "tok-2",
        userId: "user-1",
        name: "B",
        tokenHash: hashToken("b"),
      });
      const deleted = await deviceTokensRepo.deleteByUserId("user-1");
      expect(deleted).toBe(2);
      expect(await deviceTokensRepo.findByUserId("user-1")).toEqual([]);
    });

    test("returns 0 when no tokens for user", async () => {
      expect(await deviceTokensRepo.deleteByUserId("nobody")).toBe(0);
    });
  });
});
