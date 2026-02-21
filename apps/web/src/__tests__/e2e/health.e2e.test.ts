import { describe, expect, test } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17025"}`;

describe("health check", () => {
  test("GET /api/live returns 200", async () => {
    const res = await fetch(`${BASE_URL}/api/live`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
  });
});
