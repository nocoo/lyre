/**
 * Tests for `handlers/settings-tokens.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  listTokensHandler,
  createTokenHandler,
  deleteTokenHandler,
} from "../../handlers/settings-tokens";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("settings-tokens handlers", () => {
  it("401 anon", () => {
    expect(listTokensHandler(setupAnonCtx()).status).toBe(401);
    expect(createTokenHandler(setupAnonCtx(), { name: "x" }).status).toBe(401);
    expect(deleteTokenHandler(setupAnonCtx(), "x").status).toBe(401);
  });
  it("empty list", () => {
    const { ctx } = setupAuthedCtx();
    expect(listTokensHandler(ctx).status).toBe(200);
  });
  it("create validates name", () => {
    const { ctx } = setupAuthedCtx();
    expect(createTokenHandler(ctx, {}).status).toBe(400);
    expect(createTokenHandler(ctx, { name: "  " }).status).toBe(400);
    expect(
      createTokenHandler(ctx, { name: "x".repeat(101) }).status,
    ).toBe(400);
  });
  it("create + delete", () => {
    const { ctx } = setupAuthedCtx();
    const created = createTokenHandler(ctx, { name: "MacBook" });
    expect(created.status).toBe(201);
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect(deleteTokenHandler(ctx, id).status).toBe(200);
    expect(deleteTokenHandler(ctx, id).status).toBe(404);
  });
});
