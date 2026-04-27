/**
 * Database connection — legacy singleton entry point.
 *
 * Delegates to `./drivers/sqlite.ts` (Bun / better-sqlite3) for the actual
 * connection. Exports a Proxy-based `db` that lazily opens the singleton
 * on first property access, plus `resetDb` for tests.
 *
 * Wave B.6 status: this singleton is kept for back-compat while handlers
 * still import `usersRepo` etc. from `./repositories`. The new injection
 * seam is `RuntimeContext.db` + the per-handler factory in
 * `./repositories/index.ts` (Wave B.6.b will migrate handlers off the
 * singleton). The Cloudflare Worker build will use `./drivers/d1.ts` and
 * never touch this file.
 */

import { loadEnvFromProcess, type LyreEnv } from "../runtime/env";
import type { LyreDb } from "./types";

export type { LyreDb } from "./types";
export type { D1DatabaseLike } from "./drivers/d1";

/**
 * Lazy-load the sqlite driver — keeps `bun:sqlite` / `better-sqlite3` /
 * `node:fs` out of any worker bundle that touches `db/index.ts`. Worker
 * builds use `./drivers/d1.ts` directly and never trigger this require.
 */
function loadSqlite(): typeof import("./drivers/sqlite") {
  // String-built path so esbuild treats it as opaque.
  const path = "./drivers/" + "sqlite";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const req: (id: string) => unknown =
    typeof g.require === "function"
      ? g.require
      : // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require("mo" + "dule") as { createRequire: (u: string) => (id: string) => unknown }).createRequire(import.meta.url);
  return req(path) as typeof import("./drivers/sqlite");
}

export function resolveDbPath(env?: LyreEnv): string {
  return loadSqlite().resolveDbPath(env);
}

export function ensureDir(path: string): void {
  loadSqlite().ensureDir(path);
}

let dbInstance: LyreDb | null = null;

function isTestEnv(env?: LyreEnv): boolean {
  const e = env ?? loadEnvFromProcess();
  return e.NODE_ENV === "test" || e.BUN_ENV === "test";
}

function getDb(): LyreDb {
  if (dbInstance) return dbInstance;
  const sqlite = loadSqlite();
  dbInstance = sqlite.openSqliteDb(sqlite.resolveDbPath());
  return dbInstance;
}

function createTestDb(): void {
  dbInstance = loadSqlite().openSqliteDb(":memory:");
}

export function resetDb(env?: LyreEnv): void {
  const e = env ?? loadEnvFromProcess();
  if (!isTestEnv(e) && e.PLAYWRIGHT !== "1") {
    throw new Error("resetDb() can only be called in test environments");
  }
  if (!dbInstance) return;

  const tables = [
    "device_tokens",
    "settings",
    "transcriptions",
    "transcription_jobs",
    "recording_tags",
    "recordings",
    "tags",
    "folders",
    "users",
  ];
  for (const table of tables) {
    try {
      dbInstance.run(`DELETE FROM ${table}`);
    } catch {
      /* table may not exist yet */
    }
  }
}

export const db = new Proxy({} as LyreDb, {
  get(_, prop) {
    if (isTestEnv()) {
      if (!dbInstance) createTestDb();
      return dbInstance[prop];
    }
    return getDb()[prop];
  },
});
