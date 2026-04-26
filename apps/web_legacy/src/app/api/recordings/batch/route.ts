/**
 * DELETE /api/recordings/batch — Bulk delete recordings (DB + OSS cleanup).
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { batchDeleteRecordingsHandler } from "@lyre/api/handlers/recordings";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as { ids?: unknown };
  return toNextResponse(await batchDeleteRecordingsHandler(ctx, body));
}
