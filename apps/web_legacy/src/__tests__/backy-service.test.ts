import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { usersRepo } from "@lyre/api/db/repositories/users";
import { settingsRepo } from "@lyre/api/db/repositories/settings";
import {
  readBackySettings,
  maskApiKey,
  getEnvironment,
  fetchBackyHistory,
  generatePullKey,
  readPullKey,
  savePullKey,
  deletePullKey,
  findUserIdByPullKey,
  type BackyHistoryResponse,
} from "@lyre/api/services/backy";

async function seedUser() {
  await usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

describe("backy service", () => {
  beforeEach(async () => {
    resetDb();
    await seedUser();
  });

  // ── maskApiKey ──

  describe("maskApiKey", () => {
    test("masks all but last 4 characters", async () => {
      expect(maskApiKey("sk-1234567890abcdef")).toBe("***************cdef");
    });

    test("returns empty string for empty input", async () => {
      expect(maskApiKey("")).toBe("");
    });

    test("returns key as-is when 4 characters or fewer", async () => {
      expect(maskApiKey("abcd")).toBe("abcd");
      expect(maskApiKey("abc")).toBe("abc");
    });

    test("handles exactly 5 characters", async () => {
      expect(maskApiKey("12345")).toBe("*2345");
    });

    test("handles single character", async () => {
      expect(maskApiKey("x")).toBe("x");
    });
  });

  // ── getEnvironment ──

  describe("getEnvironment", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    });

    test("returns 'dev' when NODE_ENV is not production", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      expect(getEnvironment()).toBe("dev");
    });

    test("returns 'dev' when NODE_ENV is test", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      expect(getEnvironment()).toBe("dev");
    });

    test("returns 'prod' when NODE_ENV is production", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(getEnvironment()).toBe("prod");
    });

    test("returns 'dev' when NODE_ENV is undefined", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = undefined;
      expect(getEnvironment()).toBe("dev");
    });
  });

  // ── readBackySettings ──

  describe("readBackySettings", () => {
    test("returns empty strings when no settings exist", async () => {
      const result = await readBackySettings("user-1");
      expect(result).toEqual({ webhookUrl: "", apiKey: "" });
    });

    test("reads webhook URL from settings", async () => {
      await settingsRepo.upsert("user-1", "backy.webhookUrl", "https://backy.example.com/webhook");
      const result = await readBackySettings("user-1");
      expect(result.webhookUrl).toBe("https://backy.example.com/webhook");
      expect(result.apiKey).toBe("");
    });

    test("reads API key from settings", async () => {
      await settingsRepo.upsert("user-1", "backy.apiKey", "sk-test-key-123");
      const result = await readBackySettings("user-1");
      expect(result.webhookUrl).toBe("");
      expect(result.apiKey).toBe("sk-test-key-123");
    });

    test("reads both settings together", async () => {
      await settingsRepo.upsert("user-1", "backy.webhookUrl", "https://backy.example.com/webhook");
      await settingsRepo.upsert("user-1", "backy.apiKey", "sk-test-key-123");
      const result = await readBackySettings("user-1");
      expect(result).toEqual({
        webhookUrl: "https://backy.example.com/webhook",
        apiKey: "sk-test-key-123",
      });
    });

    test("does not leak settings from other users", async () => {
      await usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      await settingsRepo.upsert("user-2", "backy.webhookUrl", "https://bob.example.com/webhook");
      await settingsRepo.upsert("user-2", "backy.apiKey", "sk-bob-key");

      const result = await readBackySettings("user-1");
      expect(result).toEqual({ webhookUrl: "", apiKey: "" });
    });

    test("ignores non-backy settings", async () => {
      await settingsRepo.upsert("user-1", "ai.baseURL", "https://api.example.com");
      await settingsRepo.upsert("user-1", "backy.webhookUrl", "https://backy.example.com/webhook");
      const result = await readBackySettings("user-1");
      expect(result.webhookUrl).toBe("https://backy.example.com/webhook");
      expect(result.apiKey).toBe("");
    });

    test("returns updated values after upsert", async () => {
      await settingsRepo.upsert("user-1", "backy.webhookUrl", "https://old.example.com");
      await settingsRepo.upsert("user-1", "backy.webhookUrl", "https://new.example.com");
      const result = await readBackySettings("user-1");
      expect(result.webhookUrl).toBe("https://new.example.com");
    });
  });

  // ── fetchBackyHistory ──

  describe("fetchBackyHistory", () => {
    const credentials = {
      webhookUrl: "https://backy.example.com/api/webhook/abc",
      apiKey: "test-api-key",
    };

    const mockHistoryResponse: BackyHistoryResponse = {
      project_name: "lyre",
      environment: null,
      total_backups: 3,
      recent_backups: [
        {
          id: "backup-1",
          tag: "v1.5.1-2026-02-23-10rec",
          environment: "prod",
          file_size: 974787,
          is_single_json: 1,
          created_at: "2026-02-23T07:08:10.708Z",
        },
        {
          id: "backup-2",
          tag: "v1.5.0-2026-02-23-1rec",
          environment: "dev",
          file_size: 105683,
          is_single_json: 1,
          created_at: "2026-02-23T05:18:46.943Z",
        },
      ],
    };

    afterEach(async () => {
      mock.restore();
    });

    test("returns history data on successful GET", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockHistoryResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockHistoryResponse);
      expect(result.error).toBeNull();

      // Verify fetch was called with correct args
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
      expect(call).toBeDefined();
      const [url, opts] = call!;
      expect(url).toBe(credentials.webhookUrl);
      expect(opts.method).toBe("GET");
      expect(opts.headers).toEqual({
        Authorization: "Bearer test-api-key",
      });
    });

    test("returns error on non-ok HTTP response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Forbidden", { status: 403 })),
      ) as unknown as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(result.data).toBeNull();
      expect(result.error).toBe("Forbidden");
    });

    test("returns HTTP status as error when body is empty", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("", { status: 500 })),
      ) as unknown as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe("HTTP 500");
    });

    test("returns error on network failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error("ECONNREFUSED")),
      ) as unknown as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.data).toBeNull();
      expect(result.error).toBe("ECONNREFUSED");
    });

    test("handles non-Error thrown from fetch", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject("string error"),
      ) as unknown as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.error).toBe("string error");
    });

    test("returns history with zero backups", async () => {
      const emptyHistory: BackyHistoryResponse = {
        project_name: "empty-project",
        environment: null,
        total_backups: 0,
        recent_backups: [],
      };
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(emptyHistory), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
      ) as unknown as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(true);
      expect(result.data?.total_backups).toBe(0);
      expect(result.data?.recent_backups).toEqual([]);
    });
  });

  // ── generatePullKey ──

  describe("generatePullKey", () => {
    test("returns a 64-character hex string", async () => {
      const key = generatePullKey();
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    test("generates unique keys on each call", async () => {
      const keys = new Set(Array.from({ length: 10 }, () => generatePullKey()));
      expect(keys.size).toBe(10);
    });
  });

  // ── readPullKey / savePullKey / deletePullKey ──

  describe("pull key CRUD", () => {
    test("returns empty string when no pull key exists", async () => {
      expect(await readPullKey("user-1")).toBe("");
    });

    test("saves and reads a pull key", async () => {
      await savePullKey("user-1", "test-pull-key-abc");
      expect(await readPullKey("user-1")).toBe("test-pull-key-abc");
    });

    test("overwrites existing pull key on save", async () => {
      await savePullKey("user-1", "key-v1");
      await savePullKey("user-1", "key-v2");
      expect(await readPullKey("user-1")).toBe("key-v2");
    });

    test("deletes a pull key and returns true", async () => {
      await savePullKey("user-1", "key-to-delete");
      const deleted = await deletePullKey("user-1");
      expect(deleted).toBe(true);
      expect(await readPullKey("user-1")).toBe("");
    });

    test("returns false when deleting non-existent key", async () => {
      const deleted = await deletePullKey("user-1");
      expect(deleted).toBe(false);
    });

    test("does not leak pull keys between users", async () => {
      await usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      await savePullKey("user-1", "alice-key");
      await savePullKey("user-2", "bob-key");
      expect(await readPullKey("user-1")).toBe("alice-key");
      expect(await readPullKey("user-2")).toBe("bob-key");
    });
  });

  // ── findUserIdByPullKey ──

  describe("findUserIdByPullKey", () => {
    test("returns null when no user has the key", async () => {
      expect(await findUserIdByPullKey("nonexistent")).toBeNull();
    });

    test("returns userId for a valid pull key", async () => {
      await savePullKey("user-1", "valid-pull-key");
      expect(await findUserIdByPullKey("valid-pull-key")).toBe("user-1");
    });

    test("returns null after key is deleted", async () => {
      await savePullKey("user-1", "temp-key");
      await deletePullKey("user-1");
      expect(await findUserIdByPullKey("temp-key")).toBeNull();
    });

    test("returns correct user when multiple users have keys", async () => {
      await usersRepo.create({
        id: "user-2",
        email: "bob@test.com",
        name: "Bob",
        avatarUrl: null,
      });
      await savePullKey("user-1", "alice-key");
      await savePullKey("user-2", "bob-key");
      expect(await findUserIdByPullKey("alice-key")).toBe("user-1");
      expect(await findUserIdByPullKey("bob-key")).toBe("user-2");
    });

    test("returns null for old key after regeneration", async () => {
      await savePullKey("user-1", "old-key");
      await savePullKey("user-1", "new-key");
      expect(await findUserIdByPullKey("old-key")).toBeNull();
      expect(await findUserIdByPullKey("new-key")).toBe("user-1");
    });
  });
});
