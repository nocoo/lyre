/**
 * HEAD /api/backy/pull — Verify webhook key validity
 * POST /api/backy/pull — Trigger a backup push (machine-to-machine, no NextAuth)
 */

import type { NextRequest } from "next/server";
import { buildContext, toNextResponse } from "@/lib/handler-adapter";
import {
  backyPullHeadHandler,
  backyPullPostHandler,
} from "@lyre/api/handlers/settings-backy";

export const dynamic = "force-dynamic";

export async function HEAD(request: NextRequest) {
  const { ctx } = await buildContext(request, { requireAuth: false });
  return toNextResponse(backyPullHeadHandler(ctx));
}

export async function POST(request: NextRequest) {
  const { ctx } = await buildContext(request, { requireAuth: false });
  return toNextResponse(await backyPullPostHandler(ctx));
}
