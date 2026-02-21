import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  signV1,
  makeUploadKey,
  makeResultKey,
  presignPut,
  presignGet,
  deleteObject,
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
    const url = presignGet("uploads/u/r/test.mp3", 3600, undefined, TEST_CONFIG);
    expect(url).toContain("https://test-bucket.oss-cn-beijing.aliyuncs.com/");
    expect(url).toContain("uploads/u/r/test.mp3");
  });

  test("includes required query parameters", () => {
    const url = new URL(presignGet("key.mp3", 3600, undefined, TEST_CONFIG));
    expect(url.searchParams.get("OSSAccessKeyId")).toBe("test-key-id");
    expect(url.searchParams.get("Expires")).toBeTruthy();
    expect(url.searchParams.get("Signature")).toBeTruthy();
  });

  test("default expiry is 1 hour", () => {
    const url = new URL(presignGet("key.mp3", undefined, undefined, TEST_CONFIG));
    const expires = Number(url.searchParams.get("Expires"));
    const now = Math.floor(Date.now() / 1000);
    expect(expires).toBeGreaterThan(now + 3500);
    expect(expires).toBeLessThanOrEqual(now + 3601);
  });

  test("GET and PUT produce different signatures for same key", () => {
    const getUrl = presignGet("key.mp3", 900, undefined, TEST_CONFIG);
    const putUrl = presignPut("key.mp3", "audio/mpeg", 900, TEST_CONFIG);
    const getSig = new URL(getUrl).searchParams.get("Signature");
    const putSig = new URL(putUrl).searchParams.get("Signature");
    expect(getSig).not.toBe(putSig);
  });

  test("includes response override params in URL and signature", () => {
    const url = new URL(presignGet("key.mp3", 3600, {
      "response-content-disposition": 'attachment; filename="test.mp3"',
    }, TEST_CONFIG));
    expect(url.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="test.mp3"',
    );
    expect(url.searchParams.get("Signature")).toBeTruthy();
  });
});

// ── deleteObject ──

describe("deleteObject", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns true on 204 No Content", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const result = await deleteObject("uploads/u/r/test.mp3", TEST_CONFIG);
    expect(result).toBe(true);
  });

  test("returns true on 200 OK", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const result = await deleteObject("key.mp3", TEST_CONFIG);
    expect(result).toBe(true);
  });

  test("returns false on 403 Forbidden", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Forbidden", { status: 403 })),
    );
    const result = await deleteObject("key.mp3", TEST_CONFIG);
    expect(result).toBe(false);
  });

  test("returns false on 404 Not Found", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    );
    const result = await deleteObject("key.mp3", TEST_CONFIG);
    expect(result).toBe(false);
  });

  test("returns false on 500 Server Error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Error", { status: 500 })),
    );
    const result = await deleteObject("key.mp3", TEST_CONFIG);
    expect(result).toBe(false);
  });

  test("sends DELETE method with Authorization header", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await deleteObject("uploads/u/r/test.mp3", TEST_CONFIG);

    expect(capturedUrl).toBe(
      "https://test-bucket.oss-cn-beijing.aliyuncs.com/uploads/u/r/test.mp3",
    );
    expect(capturedInit?.method).toBe("DELETE");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^OSS test-key-id:.+$/);
    expect(headers.Date).toBeTruthy();
  });

  test("Authorization signature is base64", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await deleteObject("key.mp3", TEST_CONFIG);

    const headers = capturedInit?.headers as Record<string, string>;
    const sig = headers.Authorization.replace("OSS test-key-id:", "");
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

// ── getConfig (via presignPut without explicit config) ──

describe("getConfig (env var validation)", () => {
  const envKeys = [
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
    "OSS_BUCKET",
    "OSS_REGION",
    "OSS_ENDPOINT",
  ] as const;

  // Save and restore env for each test
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
    // Set all env vars to valid values
    process.env.OSS_ACCESS_KEY_ID = "test-id";
    process.env.OSS_ACCESS_KEY_SECRET = "test-secret";
    process.env.OSS_BUCKET = "test-bucket";
    process.env.OSS_REGION = "oss-cn-beijing";
    process.env.OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com";
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  test("throws when OSS_ACCESS_KEY_ID is missing", () => {
    delete process.env.OSS_ACCESS_KEY_ID;
    expect(() => presignPut("key.mp3", "audio/mpeg")).toThrow("Missing OSS config");
  });

  test("throws when OSS_ACCESS_KEY_SECRET is missing", () => {
    delete process.env.OSS_ACCESS_KEY_SECRET;
    expect(() => presignPut("key.mp3", "audio/mpeg")).toThrow("Missing OSS config");
  });

  test("throws when OSS_BUCKET is missing", () => {
    delete process.env.OSS_BUCKET;
    expect(() => presignPut("key.mp3", "audio/mpeg")).toThrow("Missing OSS config");
  });

  test("throws when OSS_REGION is missing", () => {
    delete process.env.OSS_REGION;
    expect(() => presignPut("key.mp3", "audio/mpeg")).toThrow("Missing OSS config");
  });

  test("throws when OSS_ENDPOINT is missing", () => {
    delete process.env.OSS_ENDPOINT;
    expect(() => presignPut("key.mp3", "audio/mpeg")).toThrow("Missing OSS config");
  });

  test("succeeds when all env vars are set", () => {
    const url = presignPut("key.mp3", "audio/mpeg");
    expect(url).toContain("https://test-bucket.oss-cn-beijing.aliyuncs.com/");
  });
});
