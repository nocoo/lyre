/**
 * Tests for `handlers/settings-ai.ts` (sync handlers only; testAi makes real
 * network calls and is covered by E2E with credentials).
 */

import { describe, expect, it } from "bun:test";
import {
  getAiSettingsHandler,
  updateAiSettingsHandler,
  testAiSettingsHandler,
} from "../../handlers/settings-ai";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";
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

describe("settings-ai sync handlers", () => {
  it("401 anon", () => {
    expect(getAiSettingsHandler(setupAnonCtx()).status).toBe(401);
    expect(updateAiSettingsHandler(setupAnonCtx(), {}).status).toBe(401);
  });
  it("get returns defaults", () => {
    const { ctx } = setupAuthedCtx();
    const res = getAiSettingsHandler(ctx);
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { hasApiKey: boolean }).hasApiKey).toBe(false);
  });
  it("400 invalid provider", () => {
    const { ctx } = setupAuthedCtx();
    expect(
      updateAiSettingsHandler(ctx, { provider: "bogus" }).status,
    ).toBe(400);
  });
  it("400 invalid sdkType", () => {
    const { ctx } = setupAuthedCtx();
    expect(
      updateAiSettingsHandler(ctx, { sdkType: "weird" }).status,
    ).toBe(400);
  });
  it("update saves and masks key", () => {
    const { ctx } = setupAuthedCtx();
    const res = updateAiSettingsHandler(ctx, {
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
    const { ctx } = setupAuthedCtx();
    expect((await testAiSettingsHandler(ctx)).status).toBe(400);
  });
  it("update accepts all valid fields", () => {
    const { ctx } = setupAuthedCtx();
    const res = updateAiSettingsHandler(ctx, {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      sdkType: "anthropic",
    });
    expect(res.status).toBe(200);
  });
  it("test handler error path returns 502 on bad provider config", async () => {
    const { user, ctx } = setupAuthedCtx();
    // Configure with provider "custom" but no baseURL/sdkType -> resolveAiConfig throws
    settingsRepo.upsert(user.id, "ai.provider", "custom");
    settingsRepo.upsert(user.id, "ai.apiKey", "sk-test");
    settingsRepo.upsert(user.id, "ai.model", "gpt-4");
    const res = await testAiSettingsHandler(ctx);
    expect(res.status).toBe(502);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { success: boolean }).success).toBe(false);
  });
  it("test handler 502 on 4xx api error (no retries)", async () => {
    const { user, ctx } = setupAuthedCtx();
    settingsRepo.upsert(user.id, "ai.provider", "anthropic");
    settingsRepo.upsert(user.id, "ai.apiKey", "sk-test");
    settingsRepo.upsert(user.id, "ai.model", "claude-sonnet-4-20250514");
    settingsRepo.upsert(user.id, "ai.sdkType", "anthropic");
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
