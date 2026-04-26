/**
 * GET    /api/recordings/[id] — Get recording detail
 * PUT    /api/recordings/[id] — Update recording (title, description, notes, folder, tags)
 * DELETE /api/recordings/[id] — Delete recording (DB + OSS cleanup)
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  getRecordingHandler,
  updateRecordingHandler,
  deleteRecordingHandler,
  type UpdateRecordingInput,
} from "@lyre/api/handlers/recordings";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  return toNextResponse(getRecordingHandler(ctx, id));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  const body = (await request.json()) as UpdateRecordingInput;
  return toNextResponse(updateRecordingHandler(ctx, id, body));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await context.params;
  return toNextResponse(await deleteRecordingHandler(ctx, id));
}
