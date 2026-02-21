/**
 * GET /api/recordings/[id]/play-url
 *
 * Generate a fresh presigned GET URL for audio playback.
 * The URL expires in 1 hour.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo } from "@/db/repositories";
import { presignGet } from "@/services/oss";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const recording = recordingsRepo.findById(id);

  if (!recording || recording.userId !== user.id) {
    return NextResponse.json(
      { error: "Recording not found" },
      { status: 404 },
    );
  }

  const playUrl = presignGet(recording.ossKey);

  return NextResponse.json({ playUrl });
}
