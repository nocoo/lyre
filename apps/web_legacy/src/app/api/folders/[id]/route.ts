/**
 * PUT    /api/folders/[id] — Update a folder (name, icon)
 * DELETE /api/folders/[id] — Delete a folder
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { foldersRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const folder = foldersRepo.findByIdAndUser(id, user.id);

  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    icon?: string;
  };

  const updates: Parameters<typeof foldersRepo.update>[1] = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.icon !== undefined) updates.icon = body.icon.trim();

  const updated = foldersRepo.update(id, updates);

  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update folder" },
      { status: 500 },
    );
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const folder = foldersRepo.findByIdAndUser(id, user.id);

  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  foldersRepo.delete(id);

  return NextResponse.json({ deleted: true });
}
