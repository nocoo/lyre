import { describe, expect, test } from "bun:test";
import { get, put, post, del, head, json } from "./helpers";

describe("settings/ai", () => {
  test("GET /api/settings/ai returns 200", async () => {
    const res = await get("/api/settings/ai");
    expect(res.status).toBe(200);
  });

  test("PUT /api/settings/ai updates config", async () => {
    const current = await get("/api/settings/ai");
    const body = await json<Record<string, unknown>>(current);
    const res = await put("/api/settings/ai", body);
    expect(res.status).toBe(200);
  });

  test("POST /api/settings/ai/test returns 400 (no API key)", async () => {
    const res = await post("/api/settings/ai/test");
    expect(res.status).toBe(400);
  });
});

describe("settings/tokens", () => {
  test("GET /api/settings/tokens returns 200 list", async () => {
    const res = await get("/api/settings/tokens");
    expect(res.status).toBe(200);
  });

  test("POST + DELETE /api/settings/tokens", async () => {
    const createRes = await post("/api/settings/tokens", {
      name: "e2e-test-token",
    });
    expect(createRes.status).toBe(201);
    const body = await json<{ id: string }>(createRes);
    expect(typeof body.id).toBe("string");

    const deleteRes = await del(`/api/settings/tokens/${body.id}`);
    expect(deleteRes.status).toBe(200);
  });
});

describe("settings/backy", () => {
  test("GET /api/settings/backy returns 200", async () => {
    const res = await get("/api/settings/backy");
    expect(res.status).toBe(200);
  });

  test("PUT /api/settings/backy updates config", async () => {
    const current = await get("/api/settings/backy");
    const body = await json<Record<string, unknown>>(current);
    const res = await put("/api/settings/backy", body);
    expect(res.status).toBe(200);
  });

  test("POST /api/settings/backy/test returns 400 (not configured)", async () => {
    const res = await post("/api/settings/backy/test");
    expect(res.status).toBe(400);
  });

  test("GET /api/settings/backy/history returns 400 (not configured)", async () => {
    const res = await get("/api/settings/backy/history");
    expect(res.status).toBe(400);
  });

  test("POST + DELETE /api/settings/backy/pull-key", async () => {
    const createRes = await post("/api/settings/backy/pull-key", {
      name: "e2e-test-key",
    });
    expect(createRes.status).toBe(200);

    const deleteRes = await del("/api/settings/backy/pull-key");
    expect(deleteRes.status).toBe(200);
  });

  test("HEAD + POST /api/settings/backy/pull (backy pull endpoint)", async () => {
    const headRes = await head("/api/settings/backy/pull");
    // 200 (no pull-key configured) or 401 (pull-key required)
    expect([200, 401]).toContain(headRes.status);

    const postRes = await post("/api/settings/backy/pull", {});
    expect([200, 401]).toContain(postRes.status);
  });
});

describe("settings/oss", () => {
  test("POST /api/settings/oss/scan returns 500 (no OSS config)", async () => {
    const res = await post("/api/settings/oss/scan");
    expect(res.status).toBe(500);
  });

  test("POST /api/settings/oss/cleanup returns 400 or 500", async () => {
    const res = await post("/api/settings/oss/cleanup");
    expect([400, 500]).toContain(res.status);
  });
});

describe("settings/backup", () => {
  test("GET /api/settings/backup/export returns 200", async () => {
    const res = await get("/api/settings/backup/export");
    expect(res.status).toBe(200);
  });

  test("POST /api/settings/backup/import returns 200 or 400", async () => {
    const res = await post("/api/settings/backup/import", {});
    expect([200, 400]).toContain(res.status);
  });

  test("POST /api/settings/backup/push returns 400 (not configured)", async () => {
    const res = await post("/api/settings/backup/push");
    expect(res.status).toBe(400);
  });
});
