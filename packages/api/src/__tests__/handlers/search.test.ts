/**
 * Tests for `handlers/search.ts`.
 */

import { describe, expect, it } from "vitest";
import { searchHandler } from "../../handlers/search";
import { createRecordingHandler } from "../../handlers/recordings";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";
import { makeRepos } from "../../db/repositories";

describe("searchHandler", () => {
  it("401 for anonymous", async () => {
    expect((await searchHandler(setupAnonCtx(), "x")).status).toBe(401);
  });
  it("returns empty for blank query", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await searchHandler(ctx, "");
    if (res.kind !== "json") throw new Error();
    expect((res.body as { results: unknown[] }).results).toEqual([]);
  });
  it("returns empty for null query", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await searchHandler(ctx, null);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { results: unknown[] }).results).toEqual([]);
  });
  it("returns results structure for authed query", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await searchHandler(ctx, "anything");
    expect(res.status).toBe(200);
  });
  it("returns matched records with shape", async () => {
    const { ctx } = await setupAuthedCtx();
    await createRecordingHandler(ctx, {
      title: "Searchable Meeting",
      fileName: "m.m4a",
      ossKey: "uploads/u/r/m.m4a",
    });
    const res = await searchHandler(ctx, "Searchable");
    if (res.kind !== "json") throw new Error();
    const body = res.body as { results: Array<{ title: string }> };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]?.title).toBe("Searchable Meeting");
  });
  it("attaches the matching folder when a recording is foldered", async () => {
    const { ctx } = await setupAuthedCtx();
    if (!ctx.user) throw new Error();
    const { folders } = makeRepos(ctx.db);
    const folder = await folders.create({
      id: crypto.randomUUID(),
      userId: ctx.user.id,
      name: "Inbox",
      icon: "folder",
    });
    await createRecordingHandler(ctx, {
      title: "Foldered Meeting",
      fileName: "x.m4a",
      ossKey: "uploads/x.m4a",
      folderId: folder.id,
    });
    const res = await searchHandler(ctx, "Foldered");
    if (res.kind !== "json") throw new Error();
    const body = res.body as {
      results: Array<{ folder: { id: string } | null }>;
    };
    expect(body.results[0]?.folder?.id).toBe(folder.id);
  });
});
