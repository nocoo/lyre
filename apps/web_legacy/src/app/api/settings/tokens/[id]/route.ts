/**
 * DELETE /api/settings/tokens/[id] — Revoke a device token
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { deleteTokenHandler } from "@lyre/api/handlers/settings-tokens";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const { id } = await params;
  return toNextResponse(deleteTokenHandler(ctx, id));
}
