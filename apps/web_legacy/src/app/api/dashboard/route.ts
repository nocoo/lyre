/**
 * GET /api/dashboard — Aggregate recording + OSS stats for the current user.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { dashboardHandler } from "@lyre/api/handlers/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(await dashboardHandler(ctx));
}
