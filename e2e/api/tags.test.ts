import { describe, expect, test } from "bun:test";
import { get, post, put, del, json } from "./helpers";

describe("tags CRUD", () => {
  let createdId: string | null = null;
  const uniqueName = `e2e-tag-${Date.now()}`;

  test("GET /api/tags returns 200 with items array", async () => {
    const res = await get("/api/tags");
    expect(res.status).toBe(200);
    const body = await json<{ items: unknown[] }>(res);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("POST /api/tags creates a tag (201)", async () => {
    const res = await post("/api/tags", { name: uniqueName });
    expect(res.status).toBe(201);
    const body = await json<{ id: string; name: string }>(res);
    expect(body.name).toBe(uniqueName);
    createdId = body.id;
  });

  test("PUT /api/tags/:id updates the tag", async () => {
    if (!createdId) return;
    const res = await put(`/api/tags/${createdId}`, {
      name: `${uniqueName}-renamed`,
    });
    expect(res.status).toBe(200);
  });

  test("DELETE /api/tags/:id deletes the tag", async () => {
    if (!createdId) return;
    const res = await del(`/api/tags/${createdId}`);
    expect(res.status).toBe(200);
    createdId = null;
  });
});
