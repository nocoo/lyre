import { describe, expect, test, beforeEach, afterEach } from "bun:test";

// `@/auth` is mocked in preload (src/__tests__/setup.ts). Drive the
// mock via `globalThis.__mockAuthSession`.

// Utility to build a minimal NextRequest-like object
type FakeReq = {
  headers: Headers;
  nextUrl: { pathname: string; origin: string };
};

function makeReq(
  pathname: string,
  {
    origin = "http://localhost:3000",
    forwardedHost,
    forwardedProto,
  }: {
    origin?: string;
    forwardedHost?: string;
    forwardedProto?: string;
  } = {},
): FakeReq {
  const headers = new Headers();
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);
  return { headers, nextUrl: { pathname, origin } };
}

describe("proxy", () => {
  const savedPlaywright = process.env.PLAYWRIGHT;

  beforeEach(() => {
    globalThis.__mockAuthSession = null;
    delete process.env.PLAYWRIGHT;
  });

  afterEach(() => {
    if (savedPlaywright !== undefined) {
      process.env.PLAYWRIGHT = savedPlaywright;
    } else {
      delete process.env.PLAYWRIGHT;
    }
  });

  async function callProxy(req: FakeReq): Promise<Response> {
    const { proxy } = await import("@/proxy");
    return proxy(req as never) as Response;
  }

  test("allows /api/auth routes without redirect", async () => {
    const req = makeReq("/api/auth/signin");
    const res = await callProxy(req);
    expect(res.headers.get("location")).toBeNull();
  });

  test("redirects logged-in user from /login to /", async () => {
    globalThis.__mockAuthSession = { user: { email: "alice@test.com" } };
    const req = makeReq("/login");
    const res = await callProxy(req);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/");
  });

  test("redirects anonymous user to /login when accessing protected page", async () => {
    globalThis.__mockAuthSession = null;
    const req = makeReq("/recordings");
    const res = await callProxy(req);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/login");
  });

  test("does NOT redirect anonymous user on /login", async () => {
    globalThis.__mockAuthSession = null;
    const req = makeReq("/login");
    const res = await callProxy(req);
    expect(res.headers.get("location")).toBeNull();
  });

  test("does NOT redirect logged-in user on protected page", async () => {
    globalThis.__mockAuthSession = { user: { email: "alice@test.com" } };
    const req = makeReq("/recordings");
    const res = await callProxy(req);
    expect(res.headers.get("location")).toBeNull();
  });

  // ── Redirect URL construction ──

  test("uses x-forwarded-host + x-forwarded-proto when present", async () => {
    globalThis.__mockAuthSession = null;
    const req = makeReq("/recordings", {
      forwardedHost: "lyre.example.com",
      forwardedProto: "https",
    });
    const res = await callProxy(req);
    const url = new URL(res.headers.get("location")!);
    expect(url.host).toBe("lyre.example.com");
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/login");
  });

  test("defaults to https when x-forwarded-host is set without proto", async () => {
    globalThis.__mockAuthSession = null;
    const req = makeReq("/recordings", { forwardedHost: "lyre.example.com" });
    const res = await callProxy(req);
    const url = new URL(res.headers.get("location")!);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("lyre.example.com");
  });

  test("falls back to nextUrl.origin when no forwarded headers", async () => {
    globalThis.__mockAuthSession = null;
    const req = makeReq("/recordings", { origin: "http://localhost:7016" });
    const res = await callProxy(req);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin).toBe("http://localhost:7016");
    expect(url.pathname).toBe("/login");
  });
});
