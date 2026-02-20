import { describe, expect, test } from "bun:test";
import {
  signV1,
  makeUploadKey,
  makeResultKey,
  presignPut,
  presignGet,
  type OssConfig,
} from "@/services/oss";

const TEST_CONFIG: OssConfig = {
  accessKeyId: "test-key-id",
  accessKeySecret: "test-key-secret",
  bucket: "test-bucket",
  region: "oss-cn-beijing",
  endpoint: "https://oss-cn-beijing.aliyuncs.com",
};

describe("signV1", () => {
  test("produces a base64 HMAC-SHA1 signature", () => {
    const sig = signV1("secret", "PUT", "/bucket/key", 1700000000, "audio/mpeg");
    // Should be a base64 string
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
    // Base64 characters only
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test("same inputs produce same signature", () => {
    const sig1 = signV1("s", "GET", "/b/k", 1700000000);
    const sig2 = signV1("s", "GET", "/b/k", 1700000000);
    expect(sig1).toBe(sig2);
  });

  test("different secrets produce different signatures", () => {
    const sig1 = signV1("secret1", "GET", "/b/k", 1700000000);
    const sig2 = signV1("secret2", "GET", "/b/k", 1700000000);
    expect(sig1).not.toBe(sig2);
  });

  test("different methods produce different signatures", () => {
    const sig1 = signV1("s", "PUT", "/b/k", 1700000000);
    const sig2 = signV1("s", "GET", "/b/k", 1700000000);
    expect(sig1).not.toBe(sig2);
  });

  test("different expires produce different signatures", () => {
    const sig1 = signV1("s", "GET", "/b/k", 1700000000);
    const sig2 = signV1("s", "GET", "/b/k", 1700000001);
    expect(sig1).not.toBe(sig2);
  });

  test("includes content type in signature when provided", () => {
    const sig1 = signV1("s", "PUT", "/b/k", 1700000000, "audio/mpeg");
    const sig2 = signV1("s", "PUT", "/b/k", 1700000000, "");
    expect(sig1).not.toBe(sig2);
  });
});

describe("makeUploadKey", () => {
  test("generates upload path", () => {
    expect(makeUploadKey("user-1", "rec-1", "test.mp3")).toBe(
      "uploads/user-1/rec-1/test.mp3",
    );
  });

  test("handles special characters in filename", () => {
    expect(makeUploadKey("u", "r", "my file (1).mp3")).toBe(
      "uploads/u/r/my file (1).mp3",
    );
  });
});

describe("makeResultKey", () => {
  test("generates result path", () => {
    expect(makeResultKey("job-1", "result.json")).toBe(
      "results/job-1/result.json",
    );
  });
});

describe("presignPut", () => {
  test("returns a valid URL", () => {
    const url = presignPut("uploads/u/r/test.mp3", "audio/mpeg", 900, TEST_CONFIG);
    expect(url).toContain("https://test-bucket.oss-cn-beijing.aliyuncs.com/");
    expect(url).toContain("uploads/u/r/test.mp3");
  });

  test("includes required query parameters", () => {
    const url = new URL(
      presignPut("key.mp3", "audio/mpeg", 900, TEST_CONFIG),
    );
    expect(url.searchParams.get("OSSAccessKeyId")).toBe("test-key-id");
    expect(url.searchParams.get("Expires")).toBeTruthy();
    expect(url.searchParams.get("Signature")).toBeTruthy();
  });

  test("expires in the future", () => {
    const url = new URL(
      presignPut("key.mp3", "audio/mpeg", 900, TEST_CONFIG),
    );
    const expires = Number(url.searchParams.get("Expires"));
    const now = Math.floor(Date.now() / 1000);
    expect(expires).toBeGreaterThan(now);
    expect(expires).toBeLessThanOrEqual(now + 901); // 900s + 1s tolerance
  });

  test("uses custom expiry", () => {
    const url = new URL(
      presignPut("key.mp3", "audio/mpeg", 60, TEST_CONFIG),
    );
    const expires = Number(url.searchParams.get("Expires"));
    const now = Math.floor(Date.now() / 1000);
    expect(expires).toBeLessThanOrEqual(now + 61);
  });

  test("signature varies with content type", () => {
    const url1 = presignPut("key.mp3", "audio/mpeg", 900, TEST_CONFIG);
    const url2 = presignPut("key.mp3", "audio/wav", 900, TEST_CONFIG);
    const sig1 = new URL(url1).searchParams.get("Signature");
    const sig2 = new URL(url2).searchParams.get("Signature");
    expect(sig1).not.toBe(sig2);
  });
});

describe("presignGet", () => {
  test("returns a valid URL", () => {
    const url = presignGet("uploads/u/r/test.mp3", 3600, TEST_CONFIG);
    expect(url).toContain("https://test-bucket.oss-cn-beijing.aliyuncs.com/");
    expect(url).toContain("uploads/u/r/test.mp3");
  });

  test("includes required query parameters", () => {
    const url = new URL(presignGet("key.mp3", 3600, TEST_CONFIG));
    expect(url.searchParams.get("OSSAccessKeyId")).toBe("test-key-id");
    expect(url.searchParams.get("Expires")).toBeTruthy();
    expect(url.searchParams.get("Signature")).toBeTruthy();
  });

  test("default expiry is 1 hour", () => {
    const url = new URL(presignGet("key.mp3", undefined, TEST_CONFIG));
    const expires = Number(url.searchParams.get("Expires"));
    const now = Math.floor(Date.now() / 1000);
    expect(expires).toBeGreaterThan(now + 3500);
    expect(expires).toBeLessThanOrEqual(now + 3601);
  });

  test("GET and PUT produce different signatures for same key", () => {
    const getUrl = presignGet("key.mp3", 900, TEST_CONFIG);
    const putUrl = presignPut("key.mp3", "audio/mpeg", 900, TEST_CONFIG);
    const getSig = new URL(getUrl).searchParams.get("Signature");
    const putSig = new URL(putUrl).searchParams.get("Signature");
    expect(getSig).not.toBe(putSig);
  });
});
