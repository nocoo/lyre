/**
 * Tests for `handlers/settings-backy.ts` (sync handlers only).
 */

import { describe, expect, it } from "bun:test";
import {
  getBackySettingsHandler,
  updateBackySettingsHandler,
  generatePullKeyHandler,
  deletePullKeyHandler,
  testBackySettingsHandler,
  backyHistoryHandler,
  backyPullHeadHandler,
  backyPullPostHandler,
} from "../../handlers/settings-backy";
import {
  makeCtx,
  setupAnonCtx,
  setupAuthedCtx,
} from "../_fixtures/runtime-context";
import { settingsRepo } from "../../db/repositories";

function withMockedFetch<T>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    impl(typeof url === "string" ? url : url.toString(), init)) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

describe("settings-backy sync handlers", () => {
  it("401 anon", () => {
    expect(getBackySettingsHandler(setupAnonCtx()).status).toBe(401);
    expect(updateBackySettingsHandler(setupAnonCtx(), {}).status).toBe(401);
    expect(generatePullKeyHandler(setupAnonCtx()).status).toBe(401);
    expect(deletePullKeyHandler(setupAnonCtx()).status).toBe(401);
  });
  it("get returns defaults", () => {
    const { ctx } = setupAuthedCtx();
    const res = getBackySettingsHandler(ctx);
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { hasApiKey: boolean; hasPullKey: boolean };
    expect(body.hasApiKey).toBe(false);
    expect(body.hasPullKey).toBe(false);
  });
  it("update saves config", () => {
    const { ctx } = setupAuthedCtx();
    const res = updateBackySettingsHandler(ctx, {
      webhookUrl: "https://example.com/hook",
      apiKey: "secret-xyz",
    });
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { hasApiKey: boolean }).hasApiKey).toBe(true);
  });
  it("generate then delete pull key", () => {
    const { ctx } = setupAuthedCtx();
    const gen = generatePullKeyHandler(ctx);
    expect(gen.status).toBe(200);
    if (gen.kind !== "json") throw new Error();
    expect(typeof (gen.body as { pullKey: string }).pullKey).toBe("string");
    expect(deletePullKeyHandler(ctx).status).toBe(200);
    // Second delete is a 400 (no key)
    expect(deletePullKeyHandler(ctx).status).toBe(400);
  });
});

describe("settings-backy network/webhook handlers", () => {
  it("test 401 anon", async () => {
    expect((await testBackySettingsHandler(setupAnonCtx())).status).toBe(401);
  });
  it("test 400 when not configured", async () => {
    const { ctx } = setupAuthedCtx();
    expect((await testBackySettingsHandler(ctx)).status).toBe(400);
  });
  it("history 401 anon", async () => {
    expect((await backyHistoryHandler(setupAnonCtx())).status).toBe(401);
  });
  it("history 400 when not configured", async () => {
    const { ctx } = setupAuthedCtx();
    expect((await backyHistoryHandler(ctx)).status).toBe(400);
  });
  it("pull HEAD missing header", () => {
    const { ctx } = setupAuthedCtx();
    expect(backyPullHeadHandler(ctx).status).toBe(401);
  });
  it("pull HEAD invalid key", () => {
    const ctx = makeCtx(null, { headers: { "x-webhook-key": "bogus" } });
    expect(backyPullHeadHandler(ctx).status).toBe(401);
  });
  it("pull POST missing header", async () => {
    const { ctx } = setupAuthedCtx();
    const res = await backyPullPostHandler(ctx);
    expect(res.status).toBe(401);
  });
  it("pull POST + valid key but missing config -> 422", async () => {
    const { user, ctx: authedCtx } = setupAuthedCtx();
    const gen = generatePullKeyHandler(authedCtx);
    if (gen.kind !== "json") throw new Error();
    const pullKey = (gen.body as { pullKey: string }).pullKey;
    void user;
    const ctx = makeCtx(null, { headers: { "x-webhook-key": pullKey } });
    const res = await backyPullPostHandler(ctx);
    expect(res.status).toBe(422);
  });
  it("test connection success path with mocked fetch", async () => {
    const { user, ctx } = setupAuthedCtx();
    settingsRepo.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    settingsRepo.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => new Response(null, { status: 200 }),
      () => testBackySettingsHandler(ctx),
    );
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { success: boolean }).success).toBe(true);
  });
  it("test connection HEAD non-ok returns ok:false body", async () => {
    const { user, ctx } = setupAuthedCtx();
    settingsRepo.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    settingsRepo.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => new Response(null, { status: 503 }),
      () => testBackySettingsHandler(ctx),
    );
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { success: boolean }).success).toBe(false);
  });
  it("test connection network error -> 502", async () => {
    const { user, ctx } = setupAuthedCtx();
    settingsRepo.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    settingsRepo.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => {
        throw new Error("network down");
      },
      () => testBackySettingsHandler(ctx),
    );
    expect(res.status).toBe(502);
  });
  it("history success path with mocked fetch", async () => {
    const { user, ctx } = setupAuthedCtx();
    settingsRepo.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    settingsRepo.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      () => backyHistoryHandler(ctx),
    );
    expect(res.status).toBe(200);
  });
  it("history non-ok -> 502", async () => {
    const { user, ctx } = setupAuthedCtx();
    settingsRepo.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    settingsRepo.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => new Response("nope", { status: 500 }),
      () => backyHistoryHandler(ctx),
    );
    expect(res.status).toBe(502);
  });
  it("pull HEAD valid key -> 200", () => {
    const { user, ctx: authedCtx } = setupAuthedCtx();
    void user;
    const gen = generatePullKeyHandler(authedCtx);
    if (gen.kind !== "json") throw new Error();
    const pullKey = (gen.body as { pullKey: string }).pullKey;
    const ctx = makeCtx(null, { headers: { "x-webhook-key": pullKey } });
    expect(backyPullHeadHandler(ctx).status).toBe(200);
  });
});
