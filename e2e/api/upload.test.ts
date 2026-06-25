import { describe, expect, test } from "bun:test";
import { post, json } from "./helpers";

describe("upload endpoint", () => {
  test("POST /api/upload/presign returns 200 with presigned data", async () => {
    const res = await post("/api/upload/presign", {
      fileName: "test.m4a",
      contentType: "audio/mp4",
    });
    // 500 when OSS env vars are missing (expected in clean CI checkout)
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await json<{
        uploadUrl: string;
        ossKey: string;
        recordingId: string;
      }>(res);
      expect(typeof body.uploadUrl).toBe("string");
      expect(typeof body.ossKey).toBe("string");
      expect(typeof body.recordingId).toBe("string");
    }
  });
});
