/**
 * PUT    /api/folders/[id] — Update a folder (name, icon)
 * DELETE /api/folders/[id] — Delete a folder
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  updateFolderHandler,
  deleteFolderHandler,
} from "@lyre/api/handlers/folders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string; icon?: string };
  return toNextResponse(updateFolderHandler(ctx, id, body));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  return toNextResponse(deleteFolderHandler(ctx, id));
}
