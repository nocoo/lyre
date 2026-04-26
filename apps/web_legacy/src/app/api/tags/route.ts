/**
 * GET  /api/tags — List all tags for the current user
 * POST /api/tags — Create a new tag
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { tagsRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tags = tagsRepo.findByUserId(user.id);
  return NextResponse.json({ items: tags });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string };

  if (!body.name?.trim()) {
    return NextResponse.json(
      { error: "Missing required field: name" },
      { status: 400 },
    );
  }

  const name = body.name.trim();

  // Check for duplicate tag name
  const existing = tagsRepo.findByNameAndUser(name, user.id);
  if (existing) {
    return NextResponse.json(
      { error: "Tag already exists", tag: existing },
      { status: 409 },
    );
  }

  const tag = tagsRepo.create({
    id: crypto.randomUUID(),
    userId: user.id,
    name,
  });

  return NextResponse.json(tag, { status: 201 });
}
