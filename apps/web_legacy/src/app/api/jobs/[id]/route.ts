/**
 * GET /api/jobs/[id] — Poll an ASR job status.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { getJobHandler } from "@lyre/api/handlers/jobs";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  return toNextResponse(await getJobHandler(ctx, id));
}
