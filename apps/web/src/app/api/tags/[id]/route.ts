/**
 * PUT  /api/tags/[id] — Rename a tag
 * DELETE /api/tags/[id] — Delete a tag (and all its recording associations)
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { tagsRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const tag = tagsRepo.findByIdAndUser(id, user.id);
  if (!tag) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Check for duplicate name
  const existing = tagsRepo.findByNameAndUser(name, user.id);
  if (existing && existing.id !== id) {
    return NextResponse.json({ error: "Tag name already exists" }, { status: 409 });
  }

  const updated = tagsRepo.update(id, { name });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const tag = tagsRepo.findByIdAndUser(id, user.id);

  if (!tag) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  // CASCADE on recording_tags handles join cleanup
  tagsRepo.delete(id);

  return NextResponse.json({ deleted: true });
}
