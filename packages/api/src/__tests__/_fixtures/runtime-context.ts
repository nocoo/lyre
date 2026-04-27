/**
 * Shared test fixture for handler tests.
 *
 * Builds a `RuntimeContext` over an in-memory SQLite database (Bun's
 * `bun:sqlite`), used as a stand-in for the production D1 binding.
 *
 * Each test should call `setupAuthedCtx()` (or `setupAnonCtx()`) to
 * start from a clean slate — both reset the in-memory DB.
 */

import { getTestDb, resetTestDb } from "./test-db";
import { makeRepos } from "../../db/repositories";
import { emptyEnv, type LyreEnv } from "../../runtime/env";
import type { RuntimeContext } from "../../runtime/context";
import type { DbUser } from "../../db/schema";

/** Build a fresh in-memory env. */
export function makeTestEnv(overrides: Partial<LyreEnv> = {}): LyreEnv {
  return { ...emptyEnv(), NODE_ENV: "test", ...overrides };
}

/** Reset the in-memory DB and return a clean test user. */
export async function seedTestUser(
  opts: { id?: string; email?: string } = {},
): Promise<DbUser> {
  resetTestDb();
  const id = opts.id ?? "test-user-1";
  const email = opts.email ?? "test@example.com";
  const { users } = makeRepos(getTestDb());
  return users.create({
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
    db: getTestDb(),
    user,
    headers: new Headers(opts.headers ?? {}),
  };
}

/** Combo: reset DB, seed a user, build ctx for that user. */
export async function setupAuthedCtx(): Promise<{
  ctx: RuntimeContext;
  user: DbUser;
}> {
  const user = await seedTestUser();
  return { ctx: makeCtx(user), user };
}

/** Anonymous ctx (no user) — useful for 401 tests. */
export function setupAnonCtx(): RuntimeContext {
  resetTestDb();
  return makeCtx(null);
}

/** Convenience: repos bound to the in-memory test DB. */
export function testRepos(): ReturnType<typeof makeRepos> {
  return makeRepos(getTestDb());
}
