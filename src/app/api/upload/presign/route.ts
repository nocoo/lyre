/**
 * POST /api/upload/presign
 *
 * Generate a presigned PUT URL for direct client-side upload to OSS.
 * Client sends: { fileName, contentType, recordingId? }
 * Server returns: { uploadUrl, ossKey, recordingId }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { presignPut, makeUploadKey } from "@/services/oss";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    fileName?: string;
    contentType?: string;
    recordingId?: string;
  };

  if (!body.fileName || !body.contentType) {
    return NextResponse.json(
      { error: "Missing required fields: fileName, contentType" },
      { status: 400 },
    );
  }

  // Only allow audio MIME types
  if (!body.contentType.startsWith("audio/")) {
    return NextResponse.json(
      { error: "Only audio files are allowed" },
      { status: 400 },
    );
  }

  const recordingId = body.recordingId ?? crypto.randomUUID();
  const ossKey = makeUploadKey(user.id, recordingId, body.fileName);

  const uploadUrl = presignPut(ossKey, body.contentType);

  return NextResponse.json({
    uploadUrl,
    ossKey,
    recordingId,
  });
}
