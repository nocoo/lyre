/**
 * Tests for `handlers/search.ts`.
 */

import { describe, expect, it } from "bun:test";
import { searchHandler } from "../../handlers/search";
import { createRecordingHandler } from "../../handlers/recordings";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("searchHandler", () => {
  it("401 for anonymous", () => {
    expect(searchHandler(setupAnonCtx(), "x").status).toBe(401);
  });
  it("returns empty for blank query", () => {
    const { ctx } = setupAuthedCtx();
    const res = searchHandler(ctx, "");
    if (res.kind !== "json") throw new Error();
    expect((res.body as { results: unknown[] }).results).toEqual([]);
  });
  it("returns empty for null query", () => {
    const { ctx } = setupAuthedCtx();
    const res = searchHandler(ctx, null);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { results: unknown[] }).results).toEqual([]);
  });
  it("returns results structure for authed query", () => {
    const { ctx } = setupAuthedCtx();
    const res = searchHandler(ctx, "anything");
    expect(res.status).toBe(200);
  });
  it("returns matched records with shape", () => {
    const { ctx } = setupAuthedCtx();
    createRecordingHandler(ctx, {
      title: "Searchable Meeting",
      fileName: "m.m4a",
      ossKey: "uploads/u/r/m.m4a",
    });
    const res = searchHandler(ctx, "Searchable");
    if (res.kind !== "json") throw new Error();
    const body = res.body as { results: Array<{ title: string }> };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]?.title).toBe("Searchable Meeting");
  });
});
