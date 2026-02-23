import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { settingsRepo } from "@/db/repositories/settings";
import {
  readBackySettings,
  maskApiKey,
  getEnvironment,
} from "@/services/backy";

function seedUser() {
  usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

describe("backy service", () => {
  beforeEach(() => {
    resetDb();
    seedUser();
  });

  // ── maskApiKey ──

  describe("maskApiKey", () => {
    test("masks all but last 4 characters", () => {
      expect(maskApiKey("sk-1234567890abcdef")).toBe("***************cdef");
    });

    test("returns empty string for empty input", () => {
      expect(maskApiKey("")).toBe("");
    });

    test("returns key as-is when 4 characters or fewer", () => {
      expect(maskApiKey("abcd")).toBe("abcd");
      expect(maskApiKey("abc")).toBe("abc");
    });

    test("handles exactly 5 characters", () => {
      expect(maskApiKey("12345")).toBe("*2345");
    });

    test("handles single character", () => {
      expect(maskApiKey("x")).toBe("x");
    });
  });

  // ── getEnvironment ──

  describe("getEnvironment", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test("returns 'dev' when NODE_ENV is not production", () => {
      process.env.NODE_ENV = "development";
      expect(getEnvironment()).toBe("dev");
    });

    test("returns 'dev' when NODE_ENV is test", () => {
      process.env.NODE_ENV = "test";
      expect(getEnvironment()).toBe("dev");
    });

    test("returns 'prod' when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";
      expect(getEnvironment()).toBe("prod");
    });

    test("returns 'dev' when NODE_ENV is undefined", () => {
      delete process.env.NODE_ENV;
      expect(getEnvironment()).toBe("dev");
    });
  });

  // ── readBackySettings ──

  describe("readBackySettings", () => {
    test("returns empty strings when no settings exist", () => {
      const result = readBackySettings("user-1");
      expect(result).toEqual({ webhookUrl: "", apiKey: "" });
    });

    test("reads webhook URL from settings", () => {
      settingsRepo.upsert("user-1", "backy.webhookUrl", "https://backy.example.com/webhook");
      const result = readBackySettings("user-1");
      expect(result.webhookUrl).toBe("https://backy.example.com/webhook");
      expect(result.apiKey).toBe("");
    });

    test("reads API key from settings", () => {
      settingsRepo.upsert("user-1", "backy.apiKey", "sk-test-key-123");
      const result = readBackySettings("user-1");
      expect(result.webhookUrl).toBe("");
      expect(result.apiKey).toBe("sk-test-key-123");
    });

    test("reads both settings together", () => {
      settingsRepo.upsert("user-1", "backy.webhookUrl", "https://backy.example.com/webhook");
      settingsRepo.upsert("user-1", "backy.apiKey", "sk-test-key-123");
      const result = readBackySettings("user-1");
      expect(result).toEqual({
        webhookUrl: "https://backy.example.com/webhook",
        apiKey: "sk-test-key-123",
      });
    });

    test("does not leak settings from other users", () => {
      usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      settingsRepo.upsert("user-2", "backy.webhookUrl", "https://bob.example.com/webhook");
      settingsRepo.upsert("user-2", "backy.apiKey", "sk-bob-key");

      const result = readBackySettings("user-1");
      expect(result).toEqual({ webhookUrl: "", apiKey: "" });
    });

    test("ignores non-backy settings", () => {
      settingsRepo.upsert("user-1", "ai.baseURL", "https://api.example.com");
      settingsRepo.upsert("user-1", "backy.webhookUrl", "https://backy.example.com/webhook");
      const result = readBackySettings("user-1");
      expect(result.webhookUrl).toBe("https://backy.example.com/webhook");
      expect(result.apiKey).toBe("");
    });

    test("returns updated values after upsert", () => {
      settingsRepo.upsert("user-1", "backy.webhookUrl", "https://old.example.com");
      settingsRepo.upsert("user-1", "backy.webhookUrl", "https://new.example.com");
      const result = readBackySettings("user-1");
      expect(result.webhookUrl).toBe("https://new.example.com");
    });
  });
});
