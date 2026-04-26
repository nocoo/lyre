/**
 * POST /api/upload/presign — Generate presigned PUT URL for direct OSS upload.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { presignUploadHandler } from "@lyre/api/handlers/upload";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as {
    fileName?: string;
    contentType?: string;
    recordingId?: string;
  };
  return toNextResponse(presignUploadHandler(ctx, body));
}
