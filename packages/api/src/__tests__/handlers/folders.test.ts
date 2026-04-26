/**
 * Tests for `handlers/folders.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  listFoldersHandler,
  createFolderHandler,
  getFolderHandler,
  updateFolderHandler,
  deleteFolderHandler,
} from "../../handlers/folders";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("listFoldersHandler", () => {
  it("returns 401 for anonymous", () => {
    const res = listFoldersHandler(setupAnonCtx());
    expect(res.status).toBe(401);
  });
  it("returns folders for authed user", () => {
    const { ctx } = setupAuthedCtx();
    const res = listFoldersHandler(ctx);
    expect(res.status).toBe(200);
    expect(res.kind).toBe("json");
    if (res.kind !== "json") throw new Error();
    expect((res.body as { items: unknown[] }).items).toEqual([]);
  });
});

describe("createFolderHandler", () => {
  it("returns 401 for anonymous", () => {
    const res = createFolderHandler(setupAnonCtx(), { name: "x" });
    expect(res.status).toBe(401);
  });
  it("400 when name missing", () => {
    const { ctx } = setupAuthedCtx();
    const res = createFolderHandler(ctx, {});
    expect(res.status).toBe(400);
  });
  it("creates folder", () => {
    const { ctx } = setupAuthedCtx();
    const res = createFolderHandler(ctx, { name: "Inbox", icon: "📥" });
    expect(res.status).toBe(201);
  });
});

describe("get/update/deleteFolderHandler", () => {
  it("404 when folder not found", () => {
    const { ctx } = setupAuthedCtx();
    expect(getFolderHandler(ctx, "missing").status).toBe(404);
    expect(updateFolderHandler(ctx, "missing", { name: "x" }).status).toBe(404);
    expect(deleteFolderHandler(ctx, "missing").status).toBe(404);
  });
  it("get/update/delete round-trip", () => {
    const { ctx } = setupAuthedCtx();
    const created = createFolderHandler(ctx, { name: "F1" });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect(getFolderHandler(ctx, id).status).toBe(200);
    expect(updateFolderHandler(ctx, id, { name: "F1b" }).status).toBe(200);
    expect(deleteFolderHandler(ctx, id).status).toBe(200);
  });
  it("401 for anonymous", () => {
    expect(getFolderHandler(setupAnonCtx(), "x").status).toBe(401);
    expect(updateFolderHandler(setupAnonCtx(), "x", {}).status).toBe(401);
    expect(deleteFolderHandler(setupAnonCtx(), "x").status).toBe(401);
  });
});
