import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo } from "@/db/repositories";
import { deleteObject } from "@/services/oss";

export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 100;

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { ids?: unknown };

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json(
      { error: "Missing or empty ids array" },
      { status: 400 },
    );
  }

  const ids = body.ids as string[];

  if (ids.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` },
      { status: 400 },
    );
  }

  // Verify ownership: only delete recordings that belong to the current user
  const ownedIds: string[] = [];
  const ossKeys: string[] = [];
  for (const id of ids) {
    const rec = recordingsRepo.findById(id);
    if (rec && rec.userId === user.id) {
      ownedIds.push(id);
      if (rec.ossKey) ossKeys.push(rec.ossKey);
    }
  }

  if (ownedIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  const deleted = recordingsRepo.deleteCascadeMany(ownedIds);

  // Delete OSS objects (best-effort, don't fail the request)
  for (const key of ossKeys) {
    deleteObject(key).catch(() => {
      console.warn(`Failed to delete OSS object: ${key}`);
    });
  }

  return NextResponse.json({ deleted });
}
