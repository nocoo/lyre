/**
 * Legacy Next.js wrapper around `@lyre/api/lib/api-auth`.
 *
 * `packages/api` cannot import `next/headers` (worker target). This thin
 * wrapper bridges the gap for the legacy Next.js app: it pulls headers
 * from `next/headers`, snapshots `process.env` via `loadEnvFromProcess`,
 * and forwards both to the framework-agnostic `getCurrentUser`.
 *
 * Legacy routes that previously called `getCurrentUser()` with no args
 * import this re-export instead, preserving call-site behavior with
 * zero changes.
 */

import { headers } from "next/headers";
import {
  getCurrentUser as getCurrentUserCore,
  hashToken,
  setAuthSessionProvider,
} from "@lyre/api/lib/api-auth";
import { loadEnvFromProcess } from "@lyre/api/runtime/env";
import { db as legacyDb } from "@lyre/api/db";
import type { DbUser } from "@lyre/api/db/schema";

export { hashToken, setAuthSessionProvider };

/** Resolve current user via Next.js `headers()` + host `process.env`. */
export async function getCurrentUser(): Promise<DbUser | null> {
  const hdrs = await headers();
  // Next 16's ReadonlyHeaders is structurally compatible with Headers.
  return getCurrentUserCore({
    headers: hdrs as unknown as Headers,
    env: loadEnvFromProcess(),
    db: legacyDb,
  });
}
