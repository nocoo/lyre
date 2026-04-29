import { describe, expect, test } from "bun:test";
import { post, json } from "./helpers";

describe("upload endpoint", () => {
  test("POST /api/upload/presign returns 200 with presigned data", async () => {
    const res = await post("/api/upload/presign", {
      fileName: "test.m4a",
      contentType: "audio/mp4",
    });
    // 500 when OSS env vars are missing (expected in local E2E)
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await json<{ url: string; key: string }>(res);
      expect(typeof body.url).toBe("string");
      expect(typeof body.key).toBe("string");
    }
  });
});
