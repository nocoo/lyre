import { describe, expect, test } from "bun:test";
import { head, post, json } from "./helpers";

describe("backy pull endpoint", () => {
  test("HEAD /api/backy/pull returns 200 or 401", async () => {
    const res = await head("/api/backy/pull");
    // 200 if no pull-key configured, 401 if pull-key is set
    expect([200, 401]).toContain(res.status);
  });

  test("POST /api/backy/pull returns 200 or 401", async () => {
    const res = await post("/api/backy/pull", {});
    expect([200, 401]).toContain(res.status);
  });
});
