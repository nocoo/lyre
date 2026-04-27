/**
 * SQLite driver — Bun (`bun:sqlite`) and Node (`better-sqlite3`).
 *
 * This is the only place that imports node:fs / bun:sqlite / better-sqlite3
 * so the rest of `@lyre/api` stays runtime-agnostic. The Cloudflare Worker
 * build uses `./d1.ts` instead and never bundles this file.
 */

import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "../schema";
import { loadEnvFromProcess, type LyreEnv } from "../../runtime/env";
import type { LyreDb } from "../types";

const isBun = typeof globalThis.Bun !== "undefined";

/** Build a CJS-style require that esbuild treats as opaque (string-built path). */
function createRequire(): (id: string) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.require === "function") return g.require as (id: string) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("mo" + "dule") as { createRequire: (url: string) => (id: string) => unknown };
  return mod.createRequire(import.meta.url);
}

const DEFAULT_DB_PATH = "database/lyre.db";

export function resolveDbPath(env?: LyreEnv): string {
  const e = env ?? loadEnvFromProcess();
  return e.LYRE_DB || DEFAULT_DB_PATH;
}

export function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  folder_id TEXT REFERENCES folders(id),
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  duration REAL,
  format TEXT,
  sample_rate INTEGER,
  oss_key TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  ai_summary TEXT,
  recorded_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('uploaded','transcribing','completed','failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recording_tags (
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, tag_id)
);

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id),
  task_id TEXT NOT NULL,
  request_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  submit_time TEXT,
  end_time TEXT,
  usage_seconds INTEGER,
  error_message TEXT,
  result_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL UNIQUE REFERENCES recordings(id),
  job_id TEXT NOT NULL REFERENCES transcription_jobs(id),
  full_text TEXT NOT NULL,
  sentences TEXT NOT NULL DEFAULT '[]',
  language TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
`;

/**
 * Open a SQLite file (or `:memory:`), apply schema bootstrap, return a
 * Drizzle handle. Picks Bun's native driver when running under Bun and
 * better-sqlite3 otherwise.
 */
export function openSqliteDb(dbPath: string): LyreDb {
  ensureDir(dbPath);

  // Concat strings at runtime so the worker bundler (esbuild) can't
  // statically resolve these paths. Worker builds never call this fn.
  const bunSqlite = "bun:" + "sqlite";
  const drizzleBun = "drizzle-orm/bun-" + "sqlite";
  const betterSqlite = "better-" + "sqlite3";
  const drizzleBetter = "drizzle-orm/better-" + "sqlite3";
  const req = createRequire();

  if (isBun) {
    const { Database } = req(bunSqlite) as { Database: new (path: string) => { exec(sql: string): void } };
    const { drizzle } = req(drizzleBun) as { drizzle: (db: unknown, opts: { schema: typeof schema }) => LyreDb };
    const sqlite = new Database(dbPath);
    sqlite.exec(INIT_SQL);
    return drizzle(sqlite, { schema });
  }

  const BetterSqlite = req(betterSqlite) as new (path: string) => { exec(sql: string): void };
  const { drizzle } = req(drizzleBetter) as { drizzle: (db: unknown, opts: { schema: typeof schema }) => LyreDb };
  const sqlite = new BetterSqlite(dbPath);
  sqlite.exec(INIT_SQL);
  return drizzle(sqlite, { schema });
}
