/**
 * Next.js adapter for `@lyre/api` handlers.
 *
 * Bridges the framework-agnostic `HandlerResponse` (from
 * `@lyre/api/handlers/http`) into a `NextResponse`. Used by every
 * legacy route under `apps/web_legacy/src/app/api/**` so route files
 * can shrink to thin adapters.
 *
 * It also builds a `RuntimeContext` per request:
 *   - `env` snapshotted from `process.env` via `loadEnvFromProcess`
 *   - `user` resolved via `getCurrentUser` from `@lyre/api/lib/api-auth`
 *     using the request's headers (no `next/headers` here — we pass the
 *     `NextRequest.headers` Headers object directly).
 *
 * Note: while `loadEnvFromProcess()` reads `process.env`, that read
 * happens inside `packages/api`, so this file does not violate the
 * audit rule (no `process.env` outside `packages/api/src/runtime/env.ts`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@lyre/api/lib/api-auth";
import { loadEnvFromProcess, type LyreEnv } from "@lyre/api/runtime/env";
import type { RuntimeContext } from "@lyre/api/runtime/context";
import type { HandlerResponse } from "@lyre/api/handlers/http";
import { db as legacyDb } from "@lyre/api/db";
// Side-effect import: registers the NextAuth session provider before any
// request hits buildContext(). Without this, /api/* routes that don't import
// `@/auth` themselves would see `getCurrentUser()` return null on every
// cookie-based session and 401 logged-in browser requests.
import "./bootstrap-auth";

/** Convert a framework-agnostic HandlerResponse into a NextResponse. */
export function toNextResponse(result: HandlerResponse): Response {
  switch (result.kind) {
    case "json":
      return NextResponse.json(result.body, {
        status: result.status,
        ...(result.headers ? { headers: result.headers } : {}),
      });
    case "text":
      return new NextResponse(result.body, {
        status: result.status,
        headers: { "content-type": "text/plain; charset=utf-8", ...result.headers },
      });
    case "bytes": {
      const body =
        result.body instanceof Uint8Array
          ? new Uint8Array(result.body)
          : new Uint8Array(result.body);
      return new NextResponse(body, {
        status: result.status,
        ...(result.headers ? { headers: result.headers } : {}),
      });
    }
    case "empty":
      return new NextResponse(null, {
        status: result.status,
        ...(result.headers ? { headers: result.headers } : {}),
      });
  }
}

/**
 * Build a RuntimeContext for a Next.js route. Resolves the current user
 * from headers + env. `requireAuth` defaults to true; pass `false` for
 * public endpoints (e.g. `/api/live`, `/api/backy/pull`).
 */
export async function buildContext(
  request: NextRequest | Request,
  opts: { requireAuth?: boolean } = {},
): Promise<{ ctx: RuntimeContext; unauthorized: boolean }> {
  const env: LyreEnv = loadEnvFromProcess();
  const headers = request.headers;
  const user = await getCurrentUser({ headers, env });
  const requireAuth = opts.requireAuth ?? true;
  return {
    ctx: { env, db: legacyDb, user, headers },
    unauthorized: requireAuth && !user,
  };
}

/** Shorthand 401 NextResponse. */
export function unauthorized401(): Response {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
