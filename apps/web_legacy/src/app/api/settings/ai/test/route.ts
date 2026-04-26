/**
 * POST /api/settings/ai/test — Test AI connection with current settings.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { testAiSettingsHandler } from "@lyre/api/handlers/settings-ai";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(await testAiSettingsHandler(ctx));
}
