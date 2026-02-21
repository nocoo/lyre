import { describe, expect, test } from "bun:test";

/**
 * E2E tests for settings sub-pages.
 *
 * Verifies that each settings page renders successfully (HTTP 200)
 * and contains the expected page title in the HTML response.
 * Also tests the settings-related API endpoints.
 */

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17025"}`;

describe("settings pages", () => {
  describe("GET /settings (General)", () => {
    test("returns 200", async () => {
      const res = await fetch(`${BASE_URL}/settings`);
      expect(res.status).toBe(200);
    });

    test("contains General page heading", async () => {
      const res = await fetch(`${BASE_URL}/settings`);
      const html = await res.text();
      expect(html).toContain("General");
    });
  });

  describe("GET /settings/ai (AI Settings)", () => {
    test("returns 200", async () => {
      const res = await fetch(`${BASE_URL}/settings/ai`);
      expect(res.status).toBe(200);
    });

    test("contains AI Settings page heading", async () => {
      const res = await fetch(`${BASE_URL}/settings/ai`);
      const html = await res.text();
      expect(html).toContain("AI Settings");
    });
  });

  describe("GET /settings/tokens (Device Tokens)", () => {
    test("returns 200", async () => {
      const res = await fetch(`${BASE_URL}/settings/tokens`);
      expect(res.status).toBe(200);
    });

    test("contains Device Tokens page heading", async () => {
      const res = await fetch(`${BASE_URL}/settings/tokens`);
      const html = await res.text();
      expect(html).toContain("Device Tokens");
    });
  });
});

describe("settings API endpoints", () => {
  describe("GET /api/settings/ai", () => {
    test("returns 200 with AI settings", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/ai`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("baseUrl");
      expect(body).toHaveProperty("model");
      // authToken should be present (may be empty)
      expect(body).toHaveProperty("authToken");
    });
  });

  describe("PUT /api/settings/ai", () => {
    test("updates AI settings and returns 200", async () => {
      // Save original
      const originalRes = await fetch(`${BASE_URL}/api/settings/ai`);
      const original = await originalRes.json();

      // Update
      const res = await fetch(`${BASE_URL}/api/settings/ai`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://test.example.com/v1",
          model: "test-model",
          authToken: "test-token-123",
        }),
      });
      expect(res.status).toBe(200);

      // Verify update persisted
      const verifyRes = await fetch(`${BASE_URL}/api/settings/ai`);
      const verified = await verifyRes.json();
      expect(verified.baseUrl).toBe("https://test.example.com/v1");
      expect(verified.model).toBe("test-model");
      expect(verified.authToken).toBe("test-token-123");

      // Restore original
      await fetch(`${BASE_URL}/api/settings/ai`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(original),
      });
    });
  });

  describe("GET /api/settings/tokens", () => {
    test("returns 200 with tokens array", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/tokens`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("POST /api/settings/tokens", () => {
    test("creates a token and returns 201", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "E2E Test Token" }),
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("token");
      expect(body.label).toBe("E2E Test Token");

      // Cleanup: delete the created token
      const deleteRes = await fetch(
        `${BASE_URL}/api/settings/tokens/${body.id}`,
        { method: "DELETE" },
      );
      expect(deleteRes.status).toBe(204);
    });
  });

  describe("DELETE /api/settings/tokens/[id]", () => {
    test("deletes a token and returns 204", async () => {
      // Create a token to delete
      const createRes = await fetch(`${BASE_URL}/api/settings/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Token To Delete" }),
      });
      const created = await createRes.json();

      // Delete it
      const res = await fetch(
        `${BASE_URL}/api/settings/tokens/${created.id}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(204);

      // Verify it's gone — listing should not include it
      const listRes = await fetch(`${BASE_URL}/api/settings/tokens`);
      const tokens = await listRes.json();
      const found = tokens.find(
        (t: { id: string }) => t.id === created.id,
      );
      expect(found).toBeUndefined();
    });

    test("returns 404 for non-existent token", async () => {
      const res = await fetch(
        `${BASE_URL}/api/settings/tokens/non-existent-id`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(404);
    });
  });
});
