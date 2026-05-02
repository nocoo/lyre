/**
 * Tests for `handlers/settings-tokens.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  listTokensHandler,
  createTokenHandler,
  deleteTokenHandler,
} from "../../handlers/settings-tokens";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("settings-tokens handlers", () => {
  it("401 anon", async () => {
    expect((await listTokensHandler(setupAnonCtx())).status).toBe(401);
    expect((await createTokenHandler(setupAnonCtx(), { name: "x" })).status).toBe(401);
    expect((await deleteTokenHandler(setupAnonCtx(), "x")).status).toBe(401);
  });
  it("empty list", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await listTokensHandler(ctx)).status).toBe(200);
  });
  it("create validates name", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await createTokenHandler(ctx, {})).status).toBe(400);
    expect((await createTokenHandler(ctx, { name: "  " })).status).toBe(400);
    expect(
      (await createTokenHandler(ctx, { name: "x".repeat(101) })).status,
    ).toBe(400);
  });
  it("create + delete", async () => {
    const { ctx } = await setupAuthedCtx();
    const created = await createTokenHandler(ctx, { name: "MacBook" });
    expect(created.status).toBe(201);
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect((await deleteTokenHandler(ctx, id)).status).toBe(200);
    expect((await deleteTokenHandler(ctx, id)).status).toBe(404);
  });
});
