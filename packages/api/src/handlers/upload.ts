/**
 * Handlers for `/api/upload/presign` — issue presigned PUT URLs for OSS upload.
 */

import { makeRepos } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import { makeUploadKey, presignPut } from "../services/oss";
import { badRequest, type HandlerResponse, json, unauthorized } from "./http";

export interface PresignInput {
	fileName?: string;
	contentType?: string;
	recordingId?: string;
}

export function isRecordingId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function isUploadFileName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 255 &&
		value !== "." &&
		value !== ".." &&
		!/[\\/?#%]/.test(value) &&
		[...value].every((character) => character.charCodeAt(0) >= 32)
	);
}

export async function presignUploadHandler(
	ctx: RuntimeContext,
	body: PresignInput,
): Promise<HandlerResponse> {
	if (!ctx.user) return unauthorized();
	if (!body?.fileName || typeof body.contentType !== "string" || !body.contentType) {
		return badRequest("Missing required fields: fileName, contentType");
	}
	if (!body.contentType.startsWith("audio/")) {
		return badRequest("Only audio files are allowed");
	}
	const recordingId = body.recordingId ?? crypto.randomUUID();
	if (!isRecordingId(recordingId) || !isUploadFileName(body.fileName))
		return badRequest("Invalid recording ID or file name");
	const existing = await makeRepos(ctx.db).recordings.findById(recordingId);
	const ossKey = makeUploadKey(ctx.user.id, recordingId, body.fileName);
	if (
		existing &&
		(existing.userId !== ctx.user.id ||
			existing.fileName !== body.fileName ||
			existing.ossKey !== ossKey)
	) {
		return json({ error: "Recording ID is already bound to another upload" }, 409);
	}
	const uploadUrl = presignPut(ossKey, body.contentType, 900, undefined, ctx.env);
	return json({ uploadUrl, ossKey, recordingId });
}
