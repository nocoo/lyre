import { describe, expect, test, afterAll } from "bun:test";
import { get, post, put, del, json } from "./helpers";

let createdId: string | null = null;

afterAll(async () => {
  if (createdId) {
    await del(`/api/folders/${createdId}`);
  }
});

describe("folders CRUD", () => {
  test("GET /api/folders returns 200 with items array", async () => {
    const res = await get("/api/folders");
    expect(res.status).toBe(200);
    const body = await json<{ items: unknown[] }>(res);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("POST /api/folders creates a folder (201)", async () => {
    const res = await post("/api/folders", { name: "e2e-test-folder" });
    expect(res.status).toBe(201);
    const body = await json<{ id: string; name: string }>(res);
    expect(body.name).toBe("e2e-test-folder");
    createdId = body.id;
  });

  test("GET /api/folders/:id returns the folder", async () => {
    if (!createdId) return;
    const res = await get(`/api/folders/${createdId}`);
    expect(res.status).toBe(200);
    const body = await json<{ id: string; name: string }>(res);
    expect(body.id).toBe(createdId);
  });

  test("PUT /api/folders/:id updates the folder", async () => {
    if (!createdId) return;
    const res = await put(`/api/folders/${createdId}`, {
      name: "e2e-test-folder-renamed",
    });
    expect(res.status).toBe(200);
  });

  test("DELETE /api/folders/:id deletes the folder", async () => {
    if (!createdId) return;
    const res = await del(`/api/folders/${createdId}`);
    expect(res.status).toBe(200);
    createdId = null;
  });
});
