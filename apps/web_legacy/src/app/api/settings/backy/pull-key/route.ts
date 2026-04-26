/**
 * POST   /api/settings/backy/pull-key — Generate a new pull key
 * DELETE /api/settings/backy/pull-key — Revoke the pull key
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  generatePullKeyHandler,
  deletePullKeyHandler,
} from "@lyre/api/handlers/settings-backy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(generatePullKeyHandler(ctx));
}

export async function DELETE(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(deletePullKeyHandler(ctx));
}
