import { describe, expect, test } from "bun:test";

/**
 * E2E tests for backup and Backy remote backup endpoints.
 *
 * Covers:
 * - GET  /api/settings/backup         (export)
 * - POST /api/settings/backup         (import)
 * - GET  /api/settings/backy          (read config)
 * - PUT  /api/settings/backy          (save config)
 * - POST /api/settings/backy/test     (test connection — expects 400 when unconfigured)
 * - POST /api/settings/backup/push    (push — expects 400 when unconfigured)
 * - GET  /api/settings/backy/history  (remote backup history — expects 400 when unconfigured)
 */

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17025"}`;

describe("backup API", () => {
  describe("GET /api/settings/backup (export)", () => {
    test("returns 200 with valid backup structure", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/backup`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.version).toBe(1);
      expect(body.exportedAt).toBeDefined();
      expect(body.user).toBeDefined();
      expect(body.user.id).toBeDefined();
      expect(body.user.email).toBeDefined();
      expect(Array.isArray(body.folders)).toBe(true);
      expect(Array.isArray(body.tags)).toBe(true);
      expect(Array.isArray(body.recordings)).toBe(true);
      expect(Array.isArray(body.transcriptionJobs)).toBe(true);
      expect(Array.isArray(body.transcriptions)).toBe(true);
      expect(Array.isArray(body.recordingTags)).toBe(true);
      expect(Array.isArray(body.deviceTokens)).toBe(true);
      expect(Array.isArray(body.settings)).toBe(true);
    });
  });

  describe("POST /api/settings/backup (import)", () => {
    test("rejects invalid JSON body", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json{{{",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    test("rejects backup with wrong version", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 999 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("unsupported version");
    });

    test("round-trips export → import successfully", async () => {
      // Export current data
      const exportRes = await fetch(`${BASE_URL}/api/settings/backup`);
      expect(exportRes.status).toBe(200);
      const backup = await exportRes.json();

      // Import it back
      const importRes = await fetch(`${BASE_URL}/api/settings/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      });
      expect(importRes.status).toBe(200);

      const result = await importRes.json();
      expect(result.success).toBe(true);
      expect(result.imported).toBeDefined();
      expect(typeof result.imported.folders).toBe("number");
      expect(typeof result.imported.tags).toBe("number");
      expect(typeof result.imported.recordings).toBe("number");
    });
  });
});

describe("backy settings API", () => {
  describe("GET /api/settings/backy", () => {
    test("returns 200 with backy config", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/backy`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("webhookUrl");
      expect(body).toHaveProperty("apiKey");
      expect(body).toHaveProperty("hasApiKey");
      expect(body).toHaveProperty("environment");
      expect(["prod", "dev"]).toContain(body.environment);
    });
  });

  describe("PUT /api/settings/backy", () => {
    test("saves and returns updated config", async () => {
      // Save settings
      const putRes = await fetch(`${BASE_URL}/api/settings/backy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "https://e2e-test.example.com/webhook",
          apiKey: "e2e-test-api-key-12345",
        }),
      });
      expect(putRes.status).toBe(200);

      const putBody = await putRes.json();
      expect(putBody.webhookUrl).toBe("https://e2e-test.example.com/webhook");
      expect(putBody.hasApiKey).toBe(true);
      // API key should be masked in response
      expect(putBody.apiKey).toContain("*");

      // Verify persistence via GET
      const getRes = await fetch(`${BASE_URL}/api/settings/backy`);
      const getBody = await getRes.json();
      expect(getBody.webhookUrl).toBe("https://e2e-test.example.com/webhook");
      expect(getBody.hasApiKey).toBe(true);

      // Cleanup: clear settings
      await fetch(`${BASE_URL}/api/settings/backy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: "", apiKey: "" }),
      });
    });
  });

  describe("POST /api/settings/backy/test (connection test)", () => {
    test("returns 400 when backy is not configured", async () => {
      // Ensure no config is set
      await fetch(`${BASE_URL}/api/settings/backy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: "", apiKey: "" }),
      });

      const res = await fetch(`${BASE_URL}/api/settings/backy/test`, {
        method: "POST",
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("configured");
    });
  });

  describe("POST /api/settings/backup/push", () => {
    test("returns 400 when backy is not configured", async () => {
      // Ensure no config is set
      await fetch(`${BASE_URL}/api/settings/backy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: "", apiKey: "" }),
      });

      const res = await fetch(`${BASE_URL}/api/settings/backup/push`, {
        method: "POST",
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("configured");
    });
  });

  describe("GET /api/settings/backy/history", () => {
    test("returns 400 when backy is not configured", async () => {
      // Ensure no config is set
      await fetch(`${BASE_URL}/api/settings/backy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: "", apiKey: "" }),
      });

      const res = await fetch(`${BASE_URL}/api/settings/backy/history`);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("configured");
    });
  });
});
