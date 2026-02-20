/**
 * Auth helper for API routes.
 *
 * Extracts the current user from the NextAuth session and ensures
 * they exist in the database (upsert on first API access).
 */

import { auth } from "@/auth";
import { usersRepo } from "@/db/repositories";
import type { DbUser } from "@/db/schema";

/**
 * Get the current authenticated user from the session.
 * Upserts the user in the database on first access.
 *
 * @returns The DB user, or null if not authenticated.
 */
export async function getCurrentUser(): Promise<DbUser | null> {
  // In E2E test mode, skip auth and use a test user
  if (
    process.env.E2E_SKIP_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return usersRepo.upsertByEmail({
      id: "e2e-test-user",
      email: "e2e@test.com",
      name: "E2E Test User",
      avatarUrl: null,
    });
  }

  const session = await auth();
  if (!session?.user?.email) return null;

  const email = session.user.email;
  const name = session.user.name ?? null;
  const avatarUrl = session.user.image ?? null;

  // Generate a stable user ID from email
  const id = `user-${Buffer.from(email).toString("base64url")}`;

  return usersRepo.upsertByEmail({ id, email, name, avatarUrl });
}
