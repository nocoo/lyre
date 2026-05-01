/**
 * Tests for `handlers/folders.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  listFoldersHandler,
  createFolderHandler,
  getFolderHandler,
  updateFolderHandler,
  deleteFolderHandler,
} from "../../handlers/folders";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("listFoldersHandler", () => {
  it("returns 401 for anonymous", async () => {
    const res = await listFoldersHandler(setupAnonCtx());
    expect(res.status).toBe(401);
  });
  it("returns folders for authed user", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await listFoldersHandler(ctx);
    expect(res.status).toBe(200);
    expect(res.kind).toBe("json");
    if (res.kind !== "json") throw new Error();
    expect((res.body as { items: unknown[] }).items).toEqual([]);
  });
});

describe("createFolderHandler", () => {
  it("returns 401 for anonymous", async () => {
    const res = await createFolderHandler(setupAnonCtx(), { name: "x" });
    expect(res.status).toBe(401);
  });
  it("400 when name missing", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await createFolderHandler(ctx, {});
    expect(res.status).toBe(400);
  });
  it("creates folder", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await createFolderHandler(ctx, { name: "Inbox", icon: "📥" });
    expect(res.status).toBe(201);
  });
});

describe("get/update/deleteFolderHandler", () => {
  it("404 when folder not found", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await getFolderHandler(ctx, "missing")).status).toBe(404);
    expect(
      (await updateFolderHandler(ctx, "missing", { name: "x" })).status,
    ).toBe(404);
    expect((await deleteFolderHandler(ctx, "missing")).status).toBe(404);
  });
  it("get/update/delete round-trip", async () => {
    const { ctx } = await setupAuthedCtx();
    const created = await createFolderHandler(ctx, { name: "F1" });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect((await getFolderHandler(ctx, id)).status).toBe(200);
    expect((await updateFolderHandler(ctx, id, { name: "F1b" })).status).toBe(
      200,
    );
    expect((await deleteFolderHandler(ctx, id)).status).toBe(200);
  });
  it("401 for anonymous", async () => {
    expect((await getFolderHandler(setupAnonCtx(), "x")).status).toBe(401);
    expect((await updateFolderHandler(setupAnonCtx(), "x", {})).status).toBe(
      401,
    );
    expect((await deleteFolderHandler(setupAnonCtx(), "x")).status).toBe(401);
  });
});
