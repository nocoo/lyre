/**
 * GET  /api/settings/tokens — List device tokens
 * POST /api/settings/tokens — Create a new device token (raw token returned once)
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  listTokensHandler,
  createTokenHandler,
} from "@lyre/api/handlers/settings-tokens";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(listTokensHandler(ctx));
}

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as { name?: string };
  return toNextResponse(createTokenHandler(ctx, body));
}
