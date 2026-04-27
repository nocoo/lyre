/**
 * Cloudflare Access JWT middleware.
 *
 * Resolves the current user from the `Cf-Access-Jwt-Assertion` header
 * issued by Cloudflare Access. Skipped entirely when:
 *
 * 1. `runtime.user` is already set (by `bearer-auth` running first), or
 * 2. `E2E_SKIP_AUTH === "true"` — in which case we synthesize a stable
 *    test user via `usersRepo.upsertByEmail`.
 *
 * TODO(security): JWT signature is NOT verified yet. We only decode the
 * payload to extract `email` / `name`. Production hardening must add a
 * JWKS fetch + RS256 verify against the team's Access certs URL
 * (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`).
 *
 * For now this is "trust the header" — fine while the Worker only runs
 * behind Cloudflare Access, which strips and re-injects the header at
 * the edge, but MUST be tightened before exposing the Worker directly.
 */

import type { MiddlewareHandler } from "hono";
import { makeUsersRepo } from "@lyre/api/db/repositories";
import type { Bindings, Variables } from "../bindings";

interface AccessPayload {
  email?: string;
  name?: string;
  sub?: string;
}

function decodePayload(jwt: string): AccessPayload | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    // Base64url decode the payload segment.
    const payload = parts[1];
    if (!payload) return null;
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64)) as AccessPayload;
  } catch {
    return null;
  }
}

export function accessAuth(): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> {
  return async (c, next) => {
    const runtime = c.get("runtime");

    // Bearer already resolved a user — nothing to do.
    if (runtime.user) {
      await next();
      return;
    }

    // E2E bypass: synthesize a stable test user.
    if (
      runtime.env.PLAYWRIGHT === "1" &&
      runtime.env.NODE_ENV !== "production"
    ) {
      const users = makeUsersRepo(runtime.db);
      runtime.user = await users.upsertByEmail({
        id: "e2e-test-user",
        email: "e2e@test.com",
        name: "E2E Test User",
        avatarUrl: null,
      });
      await next();
      return;
    }

    // Read CF Access JWT header.
    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (jwt) {
      const payload = decodePayload(jwt);
      if (payload?.email) {
        const email = payload.email;
        const name = payload.name ?? null;
        // Stable user id derived from email.
        const id = `user-${btoa(email).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
        const users = makeUsersRepo(runtime.db);
        runtime.user = await users.upsertByEmail({
          id,
          email,
          name,
          avatarUrl: null,
        });
      }
    }

    // No user resolved — DO NOT 401 here. Each route decides whether it
    // requires auth. `/api/live` is public; the rest of the handlers
    // call `unauthorized()` themselves when `ctx.user` is null.
    await next();
  };
}
