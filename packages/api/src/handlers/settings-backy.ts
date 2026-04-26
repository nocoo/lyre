/**
 * Handlers for `/api/settings/backy` (config), `/api/settings/backy/test`,
 * `/api/settings/backy/history`, `/api/settings/backy/pull-key`,
 * and the public `/api/backy/pull` webhook.
 */

import { makeRepos } from "../db/repositories";
import {
  readBackySettings,
  readPullKey,
  maskApiKey,
  getEnvironment,
  generatePullKey,
  savePullKey,
  deletePullKey,
  fetchBackyHistory,
  findUserIdByPullKey,
} from "../services/backy";
import { pushBackupToBacky } from "../services/backup";
import type { RuntimeContext } from "../runtime/context";
import type { LyreEnv } from "../runtime/env";
import {
  json,
  badRequest,
  unauthorized,
  type HandlerResponse,
} from "./http";

export async function getBackySettingsHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const settings = await readBackySettings(ctx.user.id, ctx.db);
  const pullKey = await readPullKey(ctx.user.id, ctx.db);
  return json({
    webhookUrl: settings.webhookUrl,
    apiKey: maskApiKey(settings.apiKey),
    hasApiKey: !!settings.apiKey,
    environment: getEnvironment(ctx.env),
    hasPullKey: !!pullKey,
    pullKey: pullKey || null,
  });
}

export async function updateBackySettingsHandler(
  ctx: RuntimeContext,
  body: { webhookUrl?: string; apiKey?: string },
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { settings } = makeRepos(ctx.db);
  if (body.webhookUrl !== undefined) {
    await settings.upsert(ctx.user.id, "backy.webhookUrl", body.webhookUrl);
  }
  if (body.apiKey !== undefined) {
    await settings.upsert(ctx.user.id, "backy.apiKey", body.apiKey);
  }
  const updated = await readBackySettings(ctx.user.id, ctx.db);
  return json({
    webhookUrl: updated.webhookUrl,
    apiKey: maskApiKey(updated.apiKey),
    hasApiKey: !!updated.apiKey,
  });
}

export async function testBackySettingsHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const settings = await readBackySettings(ctx.user.id, ctx.db);
  if (!settings.webhookUrl || !settings.apiKey) {
    return badRequest("Webhook URL and API key must be configured first");
  }
  const start = Date.now();
  try {
    const res = await fetch(settings.webhookUrl, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
    const durationMs = Date.now() - start;
    return json({
      success: res.ok,
      status: res.status,
      durationMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(
      {
        success: false,
        status: 0,
        error: message,
        durationMs: Date.now() - start,
      },
      502,
    );
  }
}

export async function backyHistoryHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const settings = await readBackySettings(ctx.user.id, ctx.db);
  if (!settings.webhookUrl || !settings.apiKey) {
    return badRequest("Webhook URL and API key must be configured first");
  }
  const result = await fetchBackyHistory({
    webhookUrl: settings.webhookUrl,
    apiKey: settings.apiKey,
  });
  if (!result.ok) {
    return json(
      { error: result.error ?? `HTTP ${result.status}` },
      502,
    );
  }
  return json(result.data);
}

export async function generatePullKeyHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const key = generatePullKey();
  await savePullKey(ctx.user.id, key, ctx.db);
  return json({ pullKey: key });
}

export async function deletePullKeyHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const had = await readPullKey(ctx.user.id, ctx.db);
  if (!had) return badRequest("No pull key configured");
  await deletePullKey(ctx.user.id, ctx.db);
  return json({ ok: true });
}

// ── Public Backy pull webhook (no NextAuth) ──

/**
 * Validate the X-Webhook-Key header from the request and return userId, or
 * a HandlerResponse on failure. Public endpoint — caller must NOT enforce
 * auth via RuntimeContext.user (will always be null).
 */
async function authenticateWebhookKey(
  ctx: RuntimeContext,
): Promise<{ ok: true; userId: string } | { ok: false; res: HandlerResponse }> {
  const key = ctx.headers.get("x-webhook-key");
  if (!key) {
    return {
      ok: false,
      res: json({ error: "Missing X-Webhook-Key header" }, 401),
    };
  }
  const userId = await findUserIdByPullKey(key, ctx.db);
  if (!userId) {
    return { ok: false, res: json({ error: "Invalid webhook key" }, 401) };
  }
  return { ok: true, userId };
}

export async function backyPullHeadHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  const auth = await authenticateWebhookKey(ctx);
  if (!auth.ok) return auth.res;
  return { kind: "empty", status: 200 };
}

export async function backyPullPostHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  const start = Date.now();
  const auth = await authenticateWebhookKey(ctx);
  if (!auth.ok) return auth.res;
  const userId = auth.userId;

  const pushConfig = await readBackySettings(userId, ctx.db);
  if (!pushConfig.webhookUrl || !pushConfig.apiKey) {
    return json(
      {
        ok: false,
        error:
          "Push configuration not set. Configure Backy webhook URL and API key first.",
      },
      422,
    );
  }
  const user = await makeRepos(ctx.db).users.findById(userId);
  if (!user) {
    return json({ ok: false, error: "User not found" }, 401);
  }
  const pushResult = await pushBackupToBacky(user, pushConfig, ctx.env as LyreEnv, ctx.db);
  const durationMs = Date.now() - start;
  if (!pushResult.ok) {
    return json(
      {
        ok: false,
        error: `Backup push failed (HTTP ${pushResult.status})`,
        durationMs,
        tag: pushResult.request.tag,
        fileName: pushResult.request.fileName,
        stats: pushResult.request.backupStats,
      },
      502,
    );
  }
  return json({
    ok: true,
    message: `Backup pushed successfully (${durationMs}ms)`,
    durationMs,
    tag: pushResult.request.tag,
    fileName: pushResult.request.fileName,
    stats: pushResult.request.backupStats,
  });
}
