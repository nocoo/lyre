/**
 * Tests for `handlers/settings-backy.ts` (sync handlers only).
 */

import { describe, expect, it } from "vitest";
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
  testRepos,
} from "../_fixtures/runtime-context";

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
  it("401 anon", async () => {
    expect((await getBackySettingsHandler(setupAnonCtx())).status).toBe(401);
    expect((await updateBackySettingsHandler(setupAnonCtx(), {})).status).toBe(401);
    expect((await generatePullKeyHandler(setupAnonCtx())).status).toBe(401);
    expect((await deletePullKeyHandler(setupAnonCtx())).status).toBe(401);
  });
  it("get returns defaults", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await getBackySettingsHandler(ctx);
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { hasApiKey: boolean; hasPullKey: boolean };
    expect(body.hasApiKey).toBe(false);
    expect(body.hasPullKey).toBe(false);
  });
  it("update saves config", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await updateBackySettingsHandler(ctx, {
      webhookUrl: "https://example.com/hook",
      apiKey: "secret-xyz",
    });
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { hasApiKey: boolean }).hasApiKey).toBe(true);
  });
  it("generate then delete pull key", async () => {
    const { ctx } = await setupAuthedCtx();
    const gen = await generatePullKeyHandler(ctx);
    expect(gen.status).toBe(200);
    if (gen.kind !== "json") throw new Error();
    expect(typeof (gen.body as { pullKey: string }).pullKey).toBe("string");
    expect((await deletePullKeyHandler(ctx)).status).toBe(200);
    // Second delete is a 400 (no key)
    expect((await deletePullKeyHandler(ctx)).status).toBe(400);
  });
});

describe("settings-backy network/webhook handlers", () => {
  it("test 401 anon", async () => {
    expect((await testBackySettingsHandler(setupAnonCtx())).status).toBe(401);
  });
  it("test 400 when not configured", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await testBackySettingsHandler(ctx)).status).toBe(400);
  });
  it("history 401 anon", async () => {
    expect((await backyHistoryHandler(setupAnonCtx())).status).toBe(401);
  });
  it("history 400 when not configured", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await backyHistoryHandler(ctx)).status).toBe(400);
  });
  it("pull HEAD missing header", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await backyPullHeadHandler(ctx)).status).toBe(401);
  });
  it("pull HEAD invalid key", async () => {
    const ctx = makeCtx(null, { headers: { "x-webhook-key": "bogus" } });
    expect((await backyPullHeadHandler(ctx)).status).toBe(401);
  });
  it("pull POST missing header", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await backyPullPostHandler(ctx);
    expect(res.status).toBe(401);
  });
  it("pull POST + valid key but missing config -> 422", async () => {
    const { user, ctx: authedCtx } = await setupAuthedCtx();
    const gen = await generatePullKeyHandler(authedCtx);
    if (gen.kind !== "json") throw new Error();
    const pullKey = (gen.body as { pullKey: string }).pullKey;
    void user;
    const ctx = makeCtx(null, { headers: { "x-webhook-key": pullKey } });
    const res = await backyPullPostHandler(ctx);
    expect(res.status).toBe(422);
  });
  it("test connection success path with mocked fetch", async () => {
    const { user, ctx } = await setupAuthedCtx();
    await testRepos().settings.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    await testRepos().settings.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => new Response(null, { status: 200 }),
      () => testBackySettingsHandler(ctx),
    );
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { success: boolean }).success).toBe(true);
  });
  it("test connection HEAD non-ok returns ok:false body", async () => {
    const { user, ctx } = await setupAuthedCtx();
    await testRepos().settings.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    await testRepos().settings.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => new Response(null, { status: 503 }),
      () => testBackySettingsHandler(ctx),
    );
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { success: boolean }).success).toBe(false);
  });
  it("test connection network error -> 502", async () => {
    const { user, ctx } = await setupAuthedCtx();
    await testRepos().settings.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    await testRepos().settings.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => {
        throw new Error("network down");
      },
      () => testBackySettingsHandler(ctx),
    );
    expect(res.status).toBe(502);
  });
  it("history success path with mocked fetch", async () => {
    const { user, ctx } = await setupAuthedCtx();
    await testRepos().settings.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    await testRepos().settings.upsert(user.id, "backy.apiKey", "k");
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
    const { user, ctx } = await setupAuthedCtx();
    await testRepos().settings.upsert(user.id, "backy.webhookUrl", "https://example.com/h");
    await testRepos().settings.upsert(user.id, "backy.apiKey", "k");
    const res = await withMockedFetch(
      async () => new Response("nope", { status: 500 }),
      () => backyHistoryHandler(ctx),
    );
    expect(res.status).toBe(502);
  });
  it("pull HEAD valid key -> 200", async () => {
    const { user, ctx: authedCtx } = await setupAuthedCtx();
    void user;
    const gen = await generatePullKeyHandler(authedCtx);
    if (gen.kind !== "json") throw new Error();
    const pullKey = (gen.body as { pullKey: string }).pullKey;
    const ctx = makeCtx(null, { headers: { "x-webhook-key": pullKey } });
    expect((await backyPullHeadHandler(ctx)).status).toBe(200);
  });
});
