/**
 * GET /api/settings/backy — Read Backy configuration
 * PUT /api/settings/backy — Save Backy configuration
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  getBackySettingsHandler,
  updateBackySettingsHandler,
} from "@lyre/api/handlers/settings-backy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(getBackySettingsHandler(ctx));
}

export async function PUT(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as { webhookUrl?: string; apiKey?: string };
  return toNextResponse(updateBackySettingsHandler(ctx, body));
}
