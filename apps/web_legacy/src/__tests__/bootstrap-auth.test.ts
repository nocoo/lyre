/**
 * Regression test for the auth-provider bootstrap side effect.
 *
 * Background: Wave B.3 moved `getCurrentUser` into `@lyre/api`, where
 * sessions are resolved via an injected provider. The legacy `@/auth`
 * module registers itself as that provider, but route handlers no longer
 * import `@/auth` — so the registration only happened by accident if some
 * other module in the request graph reached `auth.ts`. On routes like
 * `/api/dashboard` it didn't, and cookie-based sessions silently 401'd.
 *
 * Fix: `apps/web_legacy/src/lib/handler-adapter.ts` imports
 * `./bootstrap-auth`, which calls `setAuthSessionProvider(auth)`. This
 * test pins both contracts so the wiring can't silently regress:
 *   - `bootstrap-auth.ts` calls `setAuthSessionProvider`
 *   - `handler-adapter.ts` imports `./bootstrap-auth`
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

describe("auth provider bootstrap wiring", () => {
  test("bootstrap-auth.ts registers the NextAuth session provider", async () => {
    const src = readFileSync(join(ROOT, "lib/bootstrap-auth.ts"), "utf8");
    expect(src).toContain("setAuthSessionProvider");
    expect(src).toContain("@/auth");
  });

  test("handler-adapter.ts imports bootstrap-auth (side-effect)", async () => {
    const src = readFileSync(join(ROOT, "lib/handler-adapter.ts"), "utf8");
    expect(src).toMatch(/import\s+["']\.\/bootstrap-auth["']/);
  });
});
