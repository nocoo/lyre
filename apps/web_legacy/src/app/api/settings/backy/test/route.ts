/**
 * POST /api/settings/backy/test — Test Backy connection.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { testBackySettingsHandler } from "@lyre/api/handlers/settings-backy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(await testBackySettingsHandler(ctx));
}
