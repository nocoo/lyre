/**
 * Tests for `handlers/tags.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  listTagsHandler,
  createTagHandler,
  updateTagHandler,
  deleteTagHandler,
} from "../../handlers/tags";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("tags handlers", () => {
  it("listTagsHandler 401", () => {
    expect(listTagsHandler(setupAnonCtx()).status).toBe(401);
  });
  it("listTagsHandler returns empty list", () => {
    const { ctx } = setupAuthedCtx();
    expect(listTagsHandler(ctx).status).toBe(200);
  });
  it("createTagHandler 401", () => {
    expect(createTagHandler(setupAnonCtx(), { name: "x" }).status).toBe(401);
  });
  it("createTagHandler validates name", () => {
    const { ctx } = setupAuthedCtx();
    expect(createTagHandler(ctx, {}).status).toBe(400);
  });
  it("createTagHandler creates and refuses dup", () => {
    const { ctx } = setupAuthedCtx();
    const created = createTagHandler(ctx, { name: "alpha" });
    expect(created.status).toBe(201);
    const dup = createTagHandler(ctx, { name: "alpha" });
    expect(dup.status).toBe(409);
  });
  it("update/delete round trip", () => {
    const { ctx } = setupAuthedCtx();
    const created = createTagHandler(ctx, { name: "beta" });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect(updateTagHandler(ctx, id, { name: "gamma" }).status).toBe(200);
    expect(updateTagHandler(ctx, id, {}).status).toBe(400);
    expect(updateTagHandler(ctx, "nope", { name: "z" }).status).toBe(404);
    expect(deleteTagHandler(ctx, id).status).toBe(200);
    expect(deleteTagHandler(ctx, id).status).toBe(404);
  });
  it("401 anon for update/delete", () => {
    expect(updateTagHandler(setupAnonCtx(), "x", {}).status).toBe(401);
    expect(deleteTagHandler(setupAnonCtx(), "x").status).toBe(401);
  });
});
