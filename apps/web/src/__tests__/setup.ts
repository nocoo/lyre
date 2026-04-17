/**
 * Test preload — runs before all test files to register module mocks.
 *
 * Mocks NextAuth at the module boundary so test files can drive auth
 * outcomes without standing up a real NextAuth instance. This must live
 * in a preload because some tests import `@/proxy` (which in turn imports
 * `@/auth`) at file-evaluation time, and Bun caches module resolutions.
 */
import { mock } from "bun:test";

// Default behavior: return no session. Individual tests override
// `globalThis.__mockAuthSession` to control this.
declare global {
  var __mockAuthSession:
    | { user?: { email?: string; name?: string; image?: string } }
    | null
    | undefined;
}

mock.module("@/auth", () => ({
  // For callers that treat `auth` as an async session getter
  // (e.g. lib/api-auth.ts via `await auth()`).
  // Calling with a handler — auth((req) => ...) — returns a function that
  // injects `req.auth` and delegates. This mirrors NextAuth's usage in
  // src/proxy.ts.
  auth: (arg?: unknown) => {
    if (typeof arg === "function") {
      const handler = arg as (req: unknown) => unknown;
      return (req: unknown) => {
        (req as { auth: unknown }).auth = globalThis.__mockAuthSession ?? null;
        return handler(req);
      };
    }
    return Promise.resolve(globalThis.__mockAuthSession ?? null);
  },
}));
