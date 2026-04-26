/**
 * Tests for `handlers/upload.ts`.
 *
 * presignPut requires OSS env vars; we set them in the ctx env and assert
 * that a URL is returned. We do NOT validate the signature.
 */

import { describe, expect, it } from "bun:test";
import { presignUploadHandler } from "../../handlers/upload";
import {
  makeCtx,
  setupAnonCtx,
  setupAuthedCtx,
} from "../_fixtures/runtime-context";

describe("presignUploadHandler", () => {
  it("401 for anonymous", () => {
    expect(
      presignUploadHandler(setupAnonCtx(), {
        fileName: "x.m4a",
        contentType: "audio/m4a",
      }).status,
    ).toBe(401);
  });
  it("400 when fields missing", async () => {
    const { ctx } = await setupAuthedCtx();
    expect(presignUploadHandler(ctx, {}).status).toBe(400);
  });
  it("400 when contentType not audio", async () => {
    const { ctx } = await setupAuthedCtx();
    expect(
      presignUploadHandler(ctx, {
        fileName: "x.txt",
        contentType: "text/plain",
      }).status,
    ).toBe(400);
  });
  it("returns presigned URL when authed + audio", async () => {
    const { user } = await setupAuthedCtx();
    const ctx = makeCtx(user, {
      env: {
        OSS_ACCESS_KEY_ID: "ak",
        OSS_ACCESS_KEY_SECRET: "sk",
        OSS_BUCKET: "bucket",
        OSS_REGION: "oss-cn",
        OSS_ENDPOINT: "https://oss.example.com",
      },
    });
    const res = presignUploadHandler(ctx, {
      fileName: "rec.m4a",
      contentType: "audio/m4a",
    });
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { uploadUrl: string; ossKey: string };
    expect(body.uploadUrl).toContain("https://");
    expect(body.ossKey).toContain(user.id);
  });
});
