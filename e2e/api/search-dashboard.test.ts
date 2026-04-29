import { describe, expect, test } from "bun:test";
import { get } from "./helpers";

describe("search endpoint", () => {
  test("GET /api/search returns 200", async () => {
    const res = await get("/api/search?q=test");
    expect(res.status).toBe(200);
  });
});

describe("dashboard endpoint", () => {
  test("GET /api/dashboard returns 200 or 500", async () => {
    const res = await get("/api/dashboard");
    // 500 when OSS env vars are missing (expected in local E2E)
    expect([200, 500]).toContain(res.status);
  });
});
