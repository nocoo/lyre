/**
 * Handlers for `/api/settings/backup` and `/api/settings/backup/push`.
 */

import {
  exportBackup,
  importBackup,
  validateBackup,
  pushBackupToBacky,
} from "../services/backup";
import { readBackySettings } from "../services/backy";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  unauthorized,
  serverError,
  type HandlerResponse,
} from "./http";

export function exportBackupHandler(ctx: RuntimeContext): HandlerResponse {
  if (!ctx.user) return unauthorized();
  return json(exportBackup(ctx.user));
}

export function importBackupHandler(
  ctx: RuntimeContext,
  body: unknown,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const validation = validateBackup(body);
  if (validation !== null) {
    return badRequest(`Invalid backup: ${validation}`);
  }
  try {
    const counts = importBackup(
      ctx.user.id,
      body as Parameters<typeof importBackup>[1],
    );
    return json({ success: true, imported: counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return serverError(`Import failed: ${message}`);
  }
}

export async function pushBackupHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const backySettings = readBackySettings(ctx.user.id);
  if (!backySettings.webhookUrl || !backySettings.apiKey) {
    return badRequest("Backy webhook URL and API key must be configured first");
  }
  const result = await pushBackupToBacky(
    ctx.user,
    {
      webhookUrl: backySettings.webhookUrl,
      apiKey: backySettings.apiKey,
    },
    ctx.env,
  );
  const payload = {
    success: result.ok,
    error: result.ok ? undefined : `Backy push failed (HTTP ${result.status})`,
    request: result.request,
    response: { status: result.status, body: result.body },
    durationMs: result.durationMs,
  };
  if (!result.ok) return json(payload, 502);
  return json(payload);
}
