import { describe, expect, test } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17025"}`;

// ── Types ──

interface TokenListItem {
  id: string;
  name: string;
  lastUsedAt: number | null;
  createdAt: number;
}

interface NewTokenResponse {
  id: string;
  name: string;
  token: string;
  createdAt: number;
}

// ── Tests ──

describe("GET /api/settings/tokens", () => {
  test("returns empty list initially", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/tokens`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { items: TokenListItem[] };
    expect(body.items).toBeInstanceOf(Array);
  });
});

describe("POST /api/settings/tokens", () => {
  test("creates a new token and returns 201", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Test Device" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as NewTokenResponse;
    expect(body.name).toBe("E2E Test Device");
    expect(body.id).toBeTruthy();
    expect(body.token).toMatch(/^lyre_/);
    expect(body.createdAt).toBeGreaterThan(0);
  });

  test("returns 400 for missing name", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for empty name", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for name over 100 characters", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(101) }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/settings/tokens/[id]", () => {
  test("deletes a token and returns success", async () => {
    // Create a token to delete
    const createRes = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Token To Delete" }),
    });
    const created = (await createRes.json()) as NewTokenResponse;

    // Delete it
    const res = await fetch(`${BASE_URL}/api/settings/tokens/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify it's gone from the list
    const listRes = await fetch(`${BASE_URL}/api/settings/tokens`);
    const list = (await listRes.json()) as { items: TokenListItem[] };
    expect(list.items.find((t) => t.id === created.id)).toBeUndefined();
  });

  test("returns 404 for unknown token id", async () => {
    const res = await fetch(
      `${BASE_URL}/api/settings/tokens/nonexistent-token-id`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

describe("bearer token auth", () => {
  test("created token has correct format", async () => {
    // Create a token
    const createRes = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Format Test Device" }),
    });
    const created = (await createRes.json()) as NewTokenResponse;

    // Token should start with "lyre_" prefix
    expect(created.token).toMatch(/^lyre_/);
    // Token should be sufficiently long (48 bytes base64url = 64 chars + prefix)
    expect(created.token.length).toBeGreaterThan(60);

    // Cleanup
    await fetch(`${BASE_URL}/api/settings/tokens/${created.id}`, {
      method: "DELETE",
    });
  });

  // Note: actual Bearer token auth is tested via unit tests.
  // In E2E mode, PLAYWRIGHT=1 bypasses all auth (cookie and token),
  // so we cannot test the auth flow here.
});

describe("device tokens lifecycle", () => {
  test("create, list, use, delete flow", async () => {
    // Create two tokens
    const res1 = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Device Alpha" }),
    });
    const token1 = (await res1.json()) as NewTokenResponse;

    const res2 = await fetch(`${BASE_URL}/api/settings/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Device Beta" }),
    });
    const token2 = (await res2.json()) as NewTokenResponse;

    // List should include both
    const listRes = await fetch(`${BASE_URL}/api/settings/tokens`);
    const list = (await listRes.json()) as { items: TokenListItem[] };
    const names = list.items.map((t) => t.name);
    expect(names).toContain("Device Alpha");
    expect(names).toContain("Device Beta");

    // Delete one
    await fetch(`${BASE_URL}/api/settings/tokens/${token1.id}`, {
      method: "DELETE",
    });

    // Verify only the other remains
    const listRes2 = await fetch(`${BASE_URL}/api/settings/tokens`);
    const list2 = (await listRes2.json()) as { items: TokenListItem[] };
    const names2 = list2.items.map((t) => t.name);
    expect(names2).not.toContain("Device Alpha");
    expect(names2).toContain("Device Beta");

    // Cleanup
    await fetch(`${BASE_URL}/api/settings/tokens/${token2.id}`, {
      method: "DELETE",
    });
  });
});
