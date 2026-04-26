/**
 * Auth helper for API routes.
 *
 * Supports two authentication methods:
 * 1. NextAuth session (cookie-based, for web browser)
 * 2. Bearer token (for programmatic access, e.g. macOS app)
 *
 * Bearer tokens are hashed with SHA-256 and looked up in device_tokens table.
 *
 * Note: the NextAuth `auth()` function lives in the host app (apps/web_legacy)
 * because it is wired to that app's NextAuth singleton. The host app must
 * call `setAuthSessionProvider(auth)` once at startup so this helper can
 * resolve the session without a hard import on the host.
 */

import { createHash } from "crypto";
import { headers } from "next/headers";
import { usersRepo, deviceTokensRepo } from "../db/repositories";
import type { DbUser } from "../db/schema";

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

/**
 * Get the current authenticated user from session or Bearer token.
 *
 * Priority: E2E bypass > Bearer token > NextAuth session.
 *
 * @returns The DB user, or null if not authenticated.
 */
export async function getCurrentUser(): Promise<DbUser | null> {
  // In E2E/Playwright mode, skip auth and use a test user
  if (
    process.env.PLAYWRIGHT === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return usersRepo.upsertByEmail({
      id: "e2e-test-user",
      email: "e2e@test.com",
      name: "E2E Test User",
      avatarUrl: null,
    });
  }

  // Check for Bearer token in Authorization header
  const hdrs = await headers();
  const authorization = hdrs.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const rawToken = authorization.slice(7);
    if (rawToken) {
      const hash = hashToken(rawToken);
      const tokenRecord = deviceTokensRepo.findByHash(hash);
      if (tokenRecord) {
        // Update last-used timestamp (fire-and-forget)
        deviceTokensRepo.touchLastUsed(tokenRecord.id);
        // Resolve the user
        return usersRepo.findById(tokenRecord.userId) ?? null;
      }
      // Invalid token — fall through to return null (don't try session)
      return null;
    }
  }

  // Fall back to NextAuth session (resolved via injected provider)
  if (!authSessionProvider) return null;
  const session = await authSessionProvider();
  if (!session?.user?.email) return null;

  const email = session.user.email;
  const name = session.user.name ?? null;
  const avatarUrl = session.user.image ?? null;

  // Generate a stable user ID from email
  const id = `user-${Buffer.from(email).toString("base64url")}`;

  return usersRepo.upsertByEmail({ id, email, name, avatarUrl });
}
