/**
 * Shared test fixture for handler tests.
 *
 * Builds a `RuntimeContext` over an in-memory SQLite database (the global
 * proxy DB inside `@lyre/api` is automatically backed by `:memory:` when
 * `BUN_ENV=test`, which is the default for this workspace's `bun test`).
 *
 * Each test should call `resetDb()` and then `seedTestUser()` (or the
 * helper functions below) to start from a clean slate.
 */

import { resetDb, db } from "../../db";
import { usersRepo } from "../../db/repositories";
import { emptyEnv, type LyreEnv } from "../../runtime/env";
import type { RuntimeContext } from "../../runtime/context";
import type { DbUser } from "../../db/schema";

/** Build a fresh in-memory env. */
export function makeTestEnv(overrides: Partial<LyreEnv> = {}): LyreEnv {
  return { ...emptyEnv(), NODE_ENV: "test", BUN_ENV: "test", ...overrides };
}

/** Reset the in-memory DB and return a clean test user. */
export function seedTestUser(opts: { id?: string; email?: string } = {}): DbUser {
  resetDb();
  const id = opts.id ?? "test-user-1";
  const email = opts.email ?? "test@example.com";
  return usersRepo.create({
    id,
    email,
    name: "Test User",
    avatarUrl: null,
  });
}

/** Build a RuntimeContext with the given user (or anonymous when null). */
export function makeCtx(
  user: DbUser | null,
  opts: { headers?: HeadersInit; env?: Partial<LyreEnv> } = {},
): RuntimeContext {
  return {
    env: makeTestEnv(opts.env),
    db,
    user,
    headers: new Headers(opts.headers ?? {}),
  };
}

/** Combo: reset DB, seed a user, build ctx for that user. */
export function setupAuthedCtx(): { ctx: RuntimeContext; user: DbUser } {
  const user = seedTestUser();
  return { ctx: makeCtx(user), user };
}

/** Anonymous ctx (no user) — useful for 401 tests. */
export function setupAnonCtx(): RuntimeContext {
  resetDb();
  return makeCtx(null);
}
