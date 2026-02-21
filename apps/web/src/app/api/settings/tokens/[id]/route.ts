/**
 * DELETE /api/settings/tokens/[id] — Revoke (delete) a device token
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { deviceTokensRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const deleted = deviceTokensRepo.deleteByIdAndUser(id, user.id);
  if (!deleted) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
