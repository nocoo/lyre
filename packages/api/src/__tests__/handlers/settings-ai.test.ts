/**
 * Tests for `handlers/settings-ai.ts` (sync handlers only; testAi makes real
 * network calls and is covered by E2E with credentials).
 */

import { describe, expect, it } from "vitest";
import {
  getAiSettingsHandler,
  updateAiSettingsHandler,
  testAiSettingsHandler,
} from "../../handlers/settings-ai";
import { setupAnonCtx, setupAuthedCtx, testRepos } from "../_fixtures/runtime-context";

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

describe("settings-ai sync handlers", () => {
  it("401 anon", async () => {
    expect((await getAiSettingsHandler(setupAnonCtx())).status).toBe(401);
    expect((await updateAiSettingsHandler(setupAnonCtx(), {})).status).toBe(401);
  });
  it("get returns defaults", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await getAiSettingsHandler(ctx);
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { hasApiKey: boolean }).hasApiKey).toBe(false);
  });
  it("400 invalid provider", async () => {
    const { ctx } = await setupAuthedCtx();
    expect(
      (await updateAiSettingsHandler(ctx, { provider: "bogus" })).status,
    ).toBe(400);
  });
  it("400 invalid sdkType", async () => {
    const { ctx } = await setupAuthedCtx();
    expect(
      (await updateAiSettingsHandler(ctx, { sdkType: "weird" })).status,
    ).toBe(400);
  });
  it("update saves and masks key", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await updateAiSettingsHandler(ctx, {
      apiKey: "sk-1234567890",
      autoSummarize: true,
    });
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { apiKey: string; hasApiKey: boolean };
    expect(body.hasApiKey).toBe(true);
    expect(body.apiKey).not.toContain("sk-12345");
    expect(body.apiKey.endsWith("7890")).toBe(true);
  });
  it("test 401 anon", async () => {
    expect((await testAiSettingsHandler(setupAnonCtx())).status).toBe(401);
  });
  it("test 400 when not configured", async () => {
    const { ctx } = await setupAuthedCtx();
    expect((await testAiSettingsHandler(ctx)).status).toBe(400);
  });
  it("update accepts all valid fields", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await updateAiSettingsHandler(ctx, {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      sdkType: "anthropic",
    });
    expect(res.status).toBe(200);
  });
  it("test handler error path returns 502 on bad provider config", async () => {
    const { user, ctx } = await setupAuthedCtx();
    // Configure with provider "custom" but no baseURL/sdkType -> resolveAiConfig throws
    await testRepos().settings.upsert(user.id, "ai.provider", "custom");
    await testRepos().settings.upsert(user.id, "ai.apiKey", "sk-test");
    await testRepos().settings.upsert(user.id, "ai.model", "gpt-4");
    const res = await testAiSettingsHandler(ctx);
    expect(res.status).toBe(502);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { success: boolean }).success).toBe(false);
  });
  it("test handler 502 on 4xx api error (no retries)", async () => {
    const { user, ctx } = await setupAuthedCtx();
    await testRepos().settings.upsert(user.id, "ai.provider", "anthropic");
    await testRepos().settings.upsert(user.id, "ai.apiKey", "sk-test");
    await testRepos().settings.upsert(user.id, "ai.model", "claude-sonnet-4-20250514");
    await testRepos().settings.upsert(user.id, "ai.sdkType", "anthropic");
    const res = await withMockedFetch(
      async () =>
        new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      () => testAiSettingsHandler(ctx),
    );
    expect(res.status).toBe(502);
  }, 10000);
});
