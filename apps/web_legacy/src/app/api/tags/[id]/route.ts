/**
 * PUT  /api/tags/[id] — Rename a tag
 * DELETE /api/tags/[id] — Delete a tag (and all its recording associations)
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  updateTagHandler,
  deleteTagHandler,
} from "@lyre/api/handlers/tags";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string };
  return toNextResponse(updateTagHandler(ctx, id, body));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  return toNextResponse(deleteTagHandler(ctx, id));
}
