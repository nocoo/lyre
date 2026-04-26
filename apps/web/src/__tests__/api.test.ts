import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  apiFetch,
  apiJson,
  ApiError,
  setUnauthorizedHandler,
} from "@/lib/api";

let originalFetch: typeof fetch;

function mockFetch(impl: typeof fetch) {
  globalThis.fetch = impl;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("apiFetch", () => {
  test("forwards path and credentials:include by default", async () => {
    let capturedInit: RequestInit | undefined;
    let capturedPath: string | undefined;
    mockFetch((async (path: string, init?: RequestInit) => {
      capturedPath = path;
      capturedInit = init;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);

    await apiFetch("/api/foo");
    expect(capturedPath).toBe("/api/foo");
    expect(capturedInit?.credentials).toBe("include");
  });

  test("merges init options on top of defaults", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch((async (_path: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);

    await apiFetch("/api/foo", { method: "POST", headers: { X: "1" } });
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.credentials).toBe("include");
  });

  test("on 401 invokes the unauthorized handler and throws ApiError", async () => {
    mockFetch((async () => new Response("nope", { status: 401 })) as unknown as typeof fetch);
    const onUnauth = mock(() => {});
    const restore = setUnauthorizedHandler(onUnauth);

    await expect(apiFetch("/api/foo")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);

    restore();
  });
});

describe("apiJson", () => {
  test("parses JSON happy path", async () => {
    mockFetch((async () =>
      new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch);

    const data = await apiJson<{ hello: string }>("/api/x");
    expect(data).toEqual({ hello: "world" });
  });

  test("returns null body on empty 200 response", async () => {
    mockFetch((async () => new Response("", { status: 200 })) as unknown as typeof fetch);
    const data = await apiJson<unknown>("/api/x");
    expect(data).toBeNull();
  });

  test("throws ApiError with parsed body on non-2xx", async () => {
    mockFetch((async () =>
      new Response(JSON.stringify({ error: "bad" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch);

    try {
      await apiJson("/api/x");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.body).toEqual({ error: "bad" });
    }
  });

  test("falls back to text body when JSON is invalid", async () => {
    mockFetch((async () =>
      new Response("not json", { status: 500 })) as unknown as typeof fetch);

    try {
      await apiJson("/api/x");
      throw new Error("should have thrown");
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body).toBe("not json");
    }
  });

  test("on 401 calls the unauthorized handler exactly once", async () => {
    mockFetch((async () => new Response("", { status: 401 })) as unknown as typeof fetch);
    const onUnauth = mock(() => {});
    const restore = setUnauthorizedHandler(onUnauth);

    await expect(apiJson("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);

    restore();
  });
});
