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
      expect(body).toHaveProperty("baseURL");
      expect(body).toHaveProperty("model");
      expect(body).toHaveProperty("provider");
      expect(body).toHaveProperty("hasApiKey");
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
          baseURL: "https://test.example.com/v1",
          model: "test-model",
          apiKey: "test-key-123",
        }),
      });
      expect(res.status).toBe(200);

      // Verify update persisted
      const verifyRes = await fetch(`${BASE_URL}/api/settings/ai`);
      const verified = await verifyRes.json();
      expect(verified.baseURL).toBe("https://test.example.com/v1");
      expect(verified.model).toBe("test-model");
      expect(verified.hasApiKey).toBe(true);
      // apiKey is masked in GET response
      expect(verified.apiKey).toContain("*");
      expect(verified.apiKey).toMatch(/\*+3$/);

      // Restore original (send empty apiKey to clear)
      await fetch(`${BASE_URL}/api/settings/ai`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseURL: original.baseURL,
          model: original.model,
          apiKey: "",
        }),
      });
    });
  });

  describe("GET /api/settings/tokens", () => {
    test("returns 200 with tokens in items array", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/tokens`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("items");
      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  describe("POST /api/settings/tokens", () => {
    test("creates a token and returns 201", async () => {
      const res = await fetch(`${BASE_URL}/api/settings/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "E2E Test Token" }),
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("token");
      expect(body.name).toBe("E2E Test Token");

      // Cleanup: delete the created token
      await fetch(`${BASE_URL}/api/settings/tokens/${body.id}`, {
        method: "DELETE",
      });
    });
  });

  describe("DELETE /api/settings/tokens/[id]", () => {
    test("deletes a token and returns 200", async () => {
      // Create a token to delete
      const createRes = await fetch(`${BASE_URL}/api/settings/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Token To Delete" }),
      });
      const created = await createRes.json();

      // Delete it
      const res = await fetch(
        `${BASE_URL}/api/settings/tokens/${created.id}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.deleted).toBe(true);

      // Verify it's gone — listing should not include it
      const listRes = await fetch(`${BASE_URL}/api/settings/tokens`);
      const listing = await listRes.json();
      const found = listing.items.find(
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
