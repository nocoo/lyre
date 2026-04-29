import { describe, expect, test } from "bun:test";
import { get, json } from "./helpers";

describe("GET /api/live", () => {
  test("returns 200 with status ok", async () => {
    const res = await get("/api/live");
    expect(res.status).toBe(200);
    const body = await json<{ status: string; version: string }>(res);
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
  });
});

describe("GET /api/me", () => {
  test("returns synthesized test user when E2E_SKIP_AUTH=true", async () => {
    const res = await get("/api/me");
    expect(res.status).toBe(200);
    const body = await json<{ email: string; name: string }>(res);
    expect(body.email).toBe("e2e@test.com");
    expect(body.name).toBe("E2E Test User");
  });
});
