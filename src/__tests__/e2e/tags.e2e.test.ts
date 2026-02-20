import { describe, expect, test } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "7026"}`;

// ── Helpers ──

interface Tag {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

// ── Tests ──

describe("GET /api/tags", () => {
  test("returns empty list initially", async () => {
    const res = await fetch(`${BASE_URL}/api/tags`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { items: Tag[] };
    expect(body.items).toBeInstanceOf(Array);
  });
});

describe("POST /api/tags", () => {
  test("creates a new tag and returns 201", async () => {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "e2e-tag-1" }),
    });
    expect(res.status).toBe(201);

    const tag = (await res.json()) as Tag;
    expect(tag.name).toBe("e2e-tag-1");
    expect(tag.id).toBeTruthy();
    expect(tag.createdAt).toBeGreaterThan(0);
  });

  test("returns 409 for duplicate tag name", async () => {
    // First create
    await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "duplicate-tag" }),
    });

    // Duplicate
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "duplicate-tag" }),
    });
    expect(res.status).toBe(409);

    const body = (await res.json()) as { error: string; tag: Tag };
    expect(body.error).toContain("already exists");
    expect(body.tag.name).toBe("duplicate-tag");
  });

  test("returns 400 for missing name", async () => {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for empty name", async () => {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/tags/[id]", () => {
  test("deletes a tag and returns success", async () => {
    // Create a tag to delete
    const createRes = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tag-to-delete" }),
    });
    const tag = (await createRes.json()) as Tag;

    // Delete it
    const res = await fetch(`${BASE_URL}/api/tags/${tag.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify it's gone from the list
    const listRes = await fetch(`${BASE_URL}/api/tags`);
    const list = (await listRes.json()) as { items: Tag[] };
    expect(list.items.find((t) => t.id === tag.id)).toBeUndefined();
  });

  test("returns 404 for unknown tag id", async () => {
    const res = await fetch(`${BASE_URL}/api/tags/nonexistent-tag-id`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("tags lifecycle", () => {
  test("create, list, delete flow", async () => {
    // Create two tags
    const res1 = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "lifecycle-a" }),
    });
    const tag1 = (await res1.json()) as Tag;

    const res2 = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "lifecycle-b" }),
    });
    const tag2 = (await res2.json()) as Tag;

    // List should include both
    const listRes = await fetch(`${BASE_URL}/api/tags`);
    const list = (await listRes.json()) as { items: Tag[] };
    const names = list.items.map((t) => t.name);
    expect(names).toContain("lifecycle-a");
    expect(names).toContain("lifecycle-b");

    // Delete one
    await fetch(`${BASE_URL}/api/tags/${tag1.id}`, { method: "DELETE" });

    // Verify only the other remains
    const listRes2 = await fetch(`${BASE_URL}/api/tags`);
    const list2 = (await listRes2.json()) as { items: Tag[] };
    const names2 = list2.items.map((t) => t.name);
    expect(names2).not.toContain("lifecycle-a");
    expect(names2).toContain("lifecycle-b");

    // Cleanup
    await fetch(`${BASE_URL}/api/tags/${tag2.id}`, { method: "DELETE" });
  });
});
