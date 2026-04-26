/**
 * GET  /api/tags — List all tags for the current user
 * POST /api/tags — Create a new tag
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  listTagsHandler,
  createTagHandler,
} from "@lyre/api/handlers/tags";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(listTagsHandler(ctx));
}

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as { name?: string };
  return toNextResponse(createTagHandler(ctx, body));
}
