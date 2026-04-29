import { describe, expect, test } from "bun:test";
import { get, json } from "./helpers";

describe("jobs endpoints", () => {
  test("GET /api/jobs returns 200 list", async () => {
    const res = await get("/api/jobs");
    expect(res.status).toBe(200);
    const body = await json<{ items: unknown[] }>(res);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("GET /api/jobs/:id returns 404 for nonexistent job", async () => {
    const res = await get("/api/jobs/nonexistent-id");
    expect(res.status).toBe(404);
  });
});
