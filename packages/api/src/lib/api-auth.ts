/**
 * Auth helper for API routes — framework-agnostic.
 *
 * Supports two authentication methods:
 * 1. NextAuth session (cookie-based, for web browser) — resolved via the
 *    host-app-injected provider.
 * 2. Bearer token (for programmatic access, e.g. macOS app) — read from
 *    the request's `Authorization` header.
 *
 * Bearer tokens are hashed with SHA-256 and looked up in `device_tokens`.
 *
 * The host app must call `setAuthSessionProvider(auth)` once at startup
 * so this helper can resolve sessions without a hard dependency on
 * `next-auth` or `next/headers`.
 *
 * **No `next/*` import here.** Legacy callers that previously relied
 * on the implicit `headers()` resolution should use the wrapper at
 * `apps/web_legacy/src/lib/api-auth-legacy.ts`.
 */

import { createHash } from "crypto";
import { makeUsersRepo, makeDeviceTokensRepo } from "../db/repositories";
import type { LyreDb } from "../db/types";
import type { DbUser } from "../db/schema";
import type { LyreEnv } from "../runtime/env";

type AuthSession = {
  user?: { email?: string | null; name?: string | null; image?: string | null } | null;
} | null;

type AuthSessionProvider = () => Promise<AuthSession>;

let authSessionProvider: AuthSessionProvider | null = null;

/**
 * Inject the NextAuth `auth()` function from the host app. Must be called
 * once during app bootstrap before any API route invokes `getCurrentUser`.
 */
export function setAuthSessionProvider(provider: AuthSessionProvider): void {
  authSessionProvider = provider;
}

/** SHA-256 hash a raw token string to hex. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface GetCurrentUserOptions {
  /** Request headers — used to extract the Bearer token. */
  headers: Headers;
  /** Strongly-typed env snapshot — controls Playwright bypass branch. */
  env: LyreEnv;
  /** Per-request DB handle — Wave B.6.b removes the global singleton. */
  db: LyreDb;
}

/**
 * Get the current authenticated user from session or Bearer token.
 *
 * Priority: E2E bypass > Bearer token > NextAuth session.
 *
 * @returns The DB user, or null if not authenticated.
 */
export async function getCurrentUser(
  opts: GetCurrentUserOptions,
): Promise<DbUser | null> {
  const { headers, env, db } = opts;
  const usersRepo = makeUsersRepo(db);
  const deviceTokensRepo = makeDeviceTokensRepo(db);

  // In E2E/Playwright mode, skip auth and use a test user.
  if (env.PLAYWRIGHT === "1" && env.NODE_ENV !== "production") {
    return usersRepo.upsertByEmail({
      id: "e2e-test-user",
      email: "e2e@test.com",
      name: "E2E Test User",
      avatarUrl: null,
    });
  }

  // Check for Bearer token in Authorization header.
  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const rawToken = authorization.slice(7);
    if (rawToken) {
      const hash = hashToken(rawToken);
      const tokenRecord = await deviceTokensRepo.findByHash(hash);
      if (tokenRecord) {
        // Update last-used timestamp (fire-and-forget).
        void deviceTokensRepo.touchLastUsed(tokenRecord.id);
        return (await usersRepo.findById(tokenRecord.userId)) ?? null;
      }
      // Invalid token — fall through to return null (don't try session).
      return null;
    }
  }

  // Fall back to NextAuth session (resolved via injected provider).
  if (!authSessionProvider) return null;
  const session = await authSessionProvider();
  if (!session?.user?.email) return null;

  const email = session.user.email;
  const name = session.user.name ?? null;
  const avatarUrl = session.user.image ?? null;

  // Generate a stable user ID from email.
  const id = `user-${Buffer.from(email).toString("base64url")}`;

  return usersRepo.upsertByEmail({ id, email, name, avatarUrl });
}
