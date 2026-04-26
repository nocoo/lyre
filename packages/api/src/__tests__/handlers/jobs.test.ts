/**
 * Tests for `handlers/jobs.ts`.
 */

import { describe, expect, it } from "bun:test";
import { getJobHandler } from "../../handlers/jobs";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("getJobHandler", () => {
  it("401 anon", async () => {
    const res = await getJobHandler(setupAnonCtx(), "x");
    expect(res.status).toBe(401);
  });
  it("404 unknown job", async () => {
    const { ctx } = setupAuthedCtx();
    const res = await getJobHandler(ctx, "no-such-job");
    expect(res.status).toBe(404);
  });
});
