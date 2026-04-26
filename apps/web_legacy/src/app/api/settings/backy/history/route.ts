/**
 * GET /api/settings/backy/history — Fetch remote backup history from Backy.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { backyHistoryHandler } from "@lyre/api/handlers/settings-backy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(await backyHistoryHandler(ctx));
}
