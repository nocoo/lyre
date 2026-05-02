/**
 * Tests for `handlers/tags.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  listTagsHandler,
  createTagHandler,
  updateTagHandler,
  deleteTagHandler,
} from "../../handlers/tags";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("tags handlers", () => {
  it("listTagsHandler 401", async () => {
    expect((await listTagsHandler(setupAnonCtx())).status).toBe(401);
  });
  it("listTagsHandler returns empty list", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await listTagsHandler(ctx)).status).toBe(200);
  });
  it("createTagHandler 401", async () => {
    expect((await createTagHandler(setupAnonCtx(), { name: "x" })).status).toBe(401);
  });
  it("createTagHandler validates name", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await createTagHandler(ctx, {})).status).toBe(400);
  });
  it("createTagHandler creates and refuses dup", async () => {
    const { ctx } = await setupAuthedCtx();
    const created = await createTagHandler(ctx, { name: "alpha" });
    expect(created.status).toBe(201);
    const dup = await createTagHandler(ctx, { name: "alpha" });
    expect(dup.status).toBe(409);
  });
  it("update/delete round trip", async () => {
    const { ctx } = await setupAuthedCtx();
    const created = await createTagHandler(ctx, { name: "beta" });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect((await updateTagHandler(ctx, id, { name: "gamma" })).status).toBe(200);
    expect((await updateTagHandler(ctx, id, {})).status).toBe(400);
    expect((await updateTagHandler(ctx, "nope", { name: "z" })).status).toBe(404);
    expect((await deleteTagHandler(ctx, id)).status).toBe(200);
    expect((await deleteTagHandler(ctx, id)).status).toBe(404);
  });
  it("update conflicts when renaming to another tag's name", async () => {
    const { ctx } = await setupAuthedCtx();
    const a = await createTagHandler(ctx, { name: "one" });
    const b = await createTagHandler(ctx, { name: "two" });
    if (a.kind !== "json" || b.kind !== "json") throw new Error();
    const bId = (b.body as { id: string }).id;
    const conflict = await updateTagHandler(ctx, bId, { name: "one" });
    expect(conflict.status).toBe(409);
  });
  it("401 anon for update/delete", async () => {
    expect((await updateTagHandler(setupAnonCtx(), "x", {})).status).toBe(401);
    expect((await deleteTagHandler(setupAnonCtx(), "x")).status).toBe(401);
  });
});
