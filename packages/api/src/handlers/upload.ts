/**
 * Handlers for `/api/upload/presign` — issue presigned PUT URLs for OSS upload.
 */

import { presignPut, makeUploadKey } from "../services/oss";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  unauthorized,
  type HandlerResponse,
} from "./http";

export interface PresignInput {
  fileName?: string;
  contentType?: string;
  recordingId?: string;
}

export function presignUploadHandler(
  ctx: RuntimeContext,
  body: PresignInput,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  if (!body.fileName || !body.contentType) {
    return badRequest("Missing required fields: fileName, contentType");
  }
  if (!body.contentType.startsWith("audio/")) {
    return badRequest("Only audio files are allowed");
  }
  const recordingId = body.recordingId ?? crypto.randomUUID();
  const ossKey = makeUploadKey(ctx.user.id, recordingId, body.fileName);
  const uploadUrl = presignPut(ossKey, body.contentType, 900, undefined, ctx.env);
  return json({ uploadUrl, ossKey, recordingId });
}
