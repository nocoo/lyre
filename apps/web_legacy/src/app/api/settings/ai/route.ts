/**
 * GET /api/settings/ai — Read AI configuration for current user
 * PUT /api/settings/ai — Save AI configuration
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  getAiSettingsHandler,
  updateAiSettingsHandler,
  type UpdateAiSettingsInput,
} from "@lyre/api/handlers/settings-ai";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(getAiSettingsHandler(ctx));
}

export async function PUT(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as UpdateAiSettingsInput;
  return toNextResponse(updateAiSettingsHandler(ctx, body));
}
