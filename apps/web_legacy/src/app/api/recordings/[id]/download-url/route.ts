/**
 * GET /api/recordings/[id]/download-url — Presigned GET URL for download.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { downloadUrlHandler } from "@lyre/api/handlers/recordings";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  return toNextResponse(downloadUrlHandler(ctx, id));
}
