/**
 * GET /api/recordings/[id]/download-url
 *
 * Generate a presigned GET URL with Content-Disposition: attachment
 * for downloading the original audio file. URL expires in 1 hour.
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

  // Generate presigned URL with download content-disposition
  const downloadUrl = presignGet(recording.ossKey, 3600, {
    "response-content-disposition": `attachment; filename="${encodeURIComponent(recording.fileName)}"`,
  });

  return NextResponse.json({ downloadUrl });
}
