import { describe, expect, test } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "7026"}`;

// ── Helpers ──

interface Folder {
  id: string;
  userId: string;
  name: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
}

// ── Tests ──

describe("GET /api/folders", () => {
  test("returns empty list initially", async () => {
    const res = await fetch(`${BASE_URL}/api/folders`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { items: Folder[] };
    expect(body.items).toBeInstanceOf(Array);
  });
});

describe("POST /api/folders", () => {
  test("creates a folder with default icon", async () => {
    const res = await fetch(`${BASE_URL}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Folder" }),
    });
    expect(res.status).toBe(201);

    const folder = (await res.json()) as Folder;
    expect(folder.name).toBe("E2E Folder");
    expect(folder.icon).toBeTruthy(); // default icon
    expect(folder.id).toBeTruthy();

    // Cleanup
    await fetch(`${BASE_URL}/api/folders/${folder.id}`, { method: "DELETE" });
  });

  test("creates a folder with custom icon", async () => {
    const res = await fetch(`${BASE_URL}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Music Folder", icon: "music" }),
    });
    expect(res.status).toBe(201);

    const folder = (await res.json()) as Folder;
    expect(folder.name).toBe("Music Folder");
    expect(folder.icon).toBe("music");

    // Cleanup
    await fetch(`${BASE_URL}/api/folders/${folder.id}`, { method: "DELETE" });
  });

  test("returns 400 for missing name", async () => {
    const res = await fetch(`${BASE_URL}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/folders/[id]", () => {
  test("updates folder name and icon", async () => {
    // Create
    const createRes = await fetch(`${BASE_URL}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Original", icon: "folder" }),
    });
    const folder = (await createRes.json()) as Folder;

    // Update
    const res = await fetch(`${BASE_URL}/api/folders/${folder.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", icon: "star" }),
    });
    expect(res.status).toBe(200);

    const updated = (await res.json()) as Folder;
    expect(updated.name).toBe("Renamed");
    expect(updated.icon).toBe("star");

    // Cleanup
    await fetch(`${BASE_URL}/api/folders/${folder.id}`, { method: "DELETE" });
  });

  test("returns 404 for unknown folder", async () => {
    const res = await fetch(`${BASE_URL}/api/folders/nonexistent-folder-id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/folders/[id]", () => {
  test("deletes a folder and returns success", async () => {
    // Create
    const createRes = await fetch(`${BASE_URL}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "To Delete" }),
    });
    const folder = (await createRes.json()) as Folder;

    // Delete
    const res = await fetch(`${BASE_URL}/api/folders/${folder.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify gone
    const listRes = await fetch(`${BASE_URL}/api/folders`);
    const list = (await listRes.json()) as { items: Folder[] };
    expect(list.items.find((f) => f.id === folder.id)).toBeUndefined();
  });

  test("returns 404 for unknown folder", async () => {
    const res = await fetch(`${BASE_URL}/api/folders/nonexistent-folder-id`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("folders lifecycle", () => {
  test("create, list, update, delete flow", async () => {
    // Create
    const createRes = await fetch(`${BASE_URL}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lifecycle Folder", icon: "archive" }),
    });
    const folder = (await createRes.json()) as Folder;

    // List should include it
    const listRes = await fetch(`${BASE_URL}/api/folders`);
    const list = (await listRes.json()) as { items: Folder[] };
    expect(list.items.find((f) => f.id === folder.id)).toBeTruthy();

    // Update
    const updateRes = await fetch(`${BASE_URL}/api/folders/${folder.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Folder", icon: "box" }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as Folder;
    expect(updated.name).toBe("Updated Folder");
    expect(updated.icon).toBe("box");

    // Delete
    const delRes = await fetch(`${BASE_URL}/api/folders/${folder.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);

    // Verify gone
    const listRes2 = await fetch(`${BASE_URL}/api/folders`);
    const list2 = (await listRes2.json()) as { items: Folder[] };
    expect(list2.items.find((f) => f.id === folder.id)).toBeUndefined();
  });
});
