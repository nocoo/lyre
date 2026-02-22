import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  signV1,
  makeUploadKey,
  makeResultKey,
  presignPut,
  presignGet,
  deleteObject,
  listObjects,
  deleteObjects,
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

// ── listObjects ──

describe("listObjects", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("parses XML response with multiple objects", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
        <Contents>
          <Key>uploads/user1/rec1/audio.wav</Key>
          <LastModified>2026-01-15T10:30:00.000Z</LastModified>
          <Size>1048576</Size>
          <StorageClass>Standard</StorageClass>
        </Contents>
        <Contents>
          <Key>uploads/user1/rec2/audio.mp3</Key>
          <LastModified>2026-01-16T08:00:00.000Z</LastModified>
          <Size>524288</Size>
          <StorageClass>Standard</StorageClass>
        </Contents>
      </ListBucketResult>`;

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(xml, { status: 200 })),
    );

    const objects = await listObjects("uploads/", TEST_CONFIG);
    expect(objects).toHaveLength(2);
    expect(objects[0].key).toBe("uploads/user1/rec1/audio.wav");
    expect(objects[0].size).toBe(1048576);
    expect(objects[0].lastModified).toBe("2026-01-15T10:30:00.000Z");
    expect(objects[1].key).toBe("uploads/user1/rec2/audio.mp3");
    expect(objects[1].size).toBe(524288);
  });

  test("returns empty array for empty bucket", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
      </ListBucketResult>`;

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(xml, { status: 200 })),
    );

    const objects = await listObjects("uploads/", TEST_CONFIG);
    expect(objects).toHaveLength(0);
  });

  test("handles pagination with IsTruncated=true", async () => {
    let callCount = 0;
    const page1 = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>true</IsTruncated>
        <NextMarker>uploads/user1/rec2/audio.mp3</NextMarker>
        <Contents>
          <Key>uploads/user1/rec1/audio.wav</Key>
          <LastModified>2026-01-15T10:30:00.000Z</LastModified>
          <Size>100</Size>
          <StorageClass>Standard</StorageClass>
        </Contents>
      </ListBucketResult>`;

    const page2 = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
        <Contents>
          <Key>uploads/user1/rec2/audio.mp3</Key>
          <LastModified>2026-01-16T08:00:00.000Z</LastModified>
          <Size>200</Size>
          <StorageClass>Standard</StorageClass>
        </Contents>
      </ListBucketResult>`;

    globalThis.fetch = mock(() => {
      callCount++;
      const body = callCount === 1 ? page1 : page2;
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    const objects = await listObjects("uploads/", TEST_CONFIG);
    expect(objects).toHaveLength(2);
    expect(callCount).toBe(2);
    expect(objects[0].size).toBe(100);
    expect(objects[1].size).toBe(200);
  });

  test("sends correct Authorization header", async () => {
    let capturedInit: RequestInit | undefined;
    const xml = `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`;
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(xml, { status: 200 }));
    });

    await listObjects("uploads/", TEST_CONFIG);

    expect(capturedInit?.method).toBe("GET");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^OSS test-key-id:.+$/);
  });

  test("sends prefix query parameter", async () => {
    let capturedUrl = "";
    const xml = `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(xml, { status: 200 }));
    });

    await listObjects("results/", TEST_CONFIG);

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("prefix")).toBe("results/");
    expect(url.searchParams.get("max-keys")).toBe("1000");
  });

  test("throws on non-OK response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Forbidden", { status: 403, statusText: "Forbidden" })),
    );

    expect(listObjects("uploads/", TEST_CONFIG)).rejects.toThrow(
      "OSS listObjects failed: 403 Forbidden",
    );
  });
});

// ── deleteObjects ──

describe("deleteObjects", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 0 for empty keys array", async () => {
    const result = await deleteObjects([], TEST_CONFIG);
    expect(result).toBe(0);
  });

  test("sends POST with XML body containing object keys", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedInit: RequestInit | undefined;

    const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
      <DeleteResult>
        <Deleted><Key>uploads/u/r1/a.wav</Key></Deleted>
        <Deleted><Key>uploads/u/r2/b.wav</Key></Deleted>
      </DeleteResult>`;

    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      if (init?.body) {
        const buf = init.body as Buffer;
        capturedBody = buf.toString("utf8");
      }
      return new Response(responseXml, { status: 200 });
    });

    const result = await deleteObjects(
      ["uploads/u/r1/a.wav", "uploads/u/r2/b.wav"],
      TEST_CONFIG,
    );

    expect(result).toBe(2);
    expect(capturedUrl).toContain("?delete");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedBody).toContain("<Key>uploads/u/r1/a.wav</Key>");
    expect(capturedBody).toContain("<Key>uploads/u/r2/b.wav</Key>");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/xml");
    expect(headers["Content-MD5"]).toBeTruthy();
    expect(headers.Authorization).toMatch(/^OSS test-key-id:.+$/);
  });

  test("escapes XML special characters in keys", async () => {
    let capturedBody = "";
    const responseXml = `<DeleteResult><Deleted><Key>k</Key></Deleted></DeleteResult>`;

    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = (init.body as Buffer).toString("utf8");
      }
      return new Response(responseXml, { status: 200 });
    });

    await deleteObjects(["test&<>file.wav"], TEST_CONFIG);

    expect(capturedBody).toContain("test&amp;&lt;&gt;file.wav");
  });

  test("handles failed batch gracefully", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Error", { status: 500 })),
    );

    const result = await deleteObjects(["key1", "key2"], TEST_CONFIG);
    expect(result).toBe(0);
  });
});
