import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { settingsRepo } from "@/db/repositories/settings";
import {
  readBackySettings,
  maskApiKey,
  getEnvironment,
  fetchBackyHistory,
  type BackyHistoryResponse,
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

    afterEach(() => {
      mock.restore();
    });

    test("returns history data on successful GET", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockHistoryResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
      );
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockHistoryResponse);
      expect(result.error).toBeNull();

      // Verify fetch was called with correct args
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(credentials.webhookUrl);
      expect((opts as RequestInit).method).toBe("GET");
      expect((opts as RequestInit).headers).toEqual({
        Authorization: "Bearer test-api-key",
      });
    });

    test("returns error on non-ok HTTP response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Forbidden", { status: 403 })),
      ) as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(result.data).toBeNull();
      expect(result.error).toBe("Forbidden");
    });

    test("returns HTTP status as error when body is empty", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("", { status: 500 })),
      ) as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe("HTTP 500");
    });

    test("returns error on network failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error("ECONNREFUSED")),
      ) as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.data).toBeNull();
      expect(result.error).toBe("ECONNREFUSED");
    });

    test("handles non-Error thrown from fetch", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject("string error"),
      ) as typeof fetch;

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
      ) as typeof fetch;

      const result = await fetchBackyHistory(credentials);

      expect(result.ok).toBe(true);
      expect(result.data?.total_backups).toBe(0);
      expect(result.data?.recent_backups).toEqual([]);
    });
  });
});
