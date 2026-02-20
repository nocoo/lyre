/**
 * GET  /api/folders — List all folders for the current user
 * POST /api/folders — Create a new folder
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { foldersRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folders = foldersRepo.findByUserId(user.id);
  return NextResponse.json({ items: folders });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string; icon?: string };

  if (!body.name?.trim()) {
    return NextResponse.json(
      { error: "Missing required field: name" },
      { status: 400 },
    );
  }

  const folder = foldersRepo.create({
    id: crypto.randomUUID(),
    userId: user.id,
    name: body.name.trim(),
    icon: body.icon?.trim() || undefined,
  });

  return NextResponse.json(folder, { status: 201 });
}
