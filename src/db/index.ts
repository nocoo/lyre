/**
 * Database connection management for Lyre.
 *
 * Supports dual runtime (Bun / Node.js):
 *   - Bun: uses bun:sqlite + drizzle-orm/bun-sqlite
 *   - Node: uses better-sqlite3 + drizzle-orm/better-sqlite3
 *
 * Exports a Proxy-based `db` that lazily initializes the connection.
 * In test environments, uses an in-memory database.
 */

import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema";

// ── Types ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

const isBun = typeof globalThis.Bun !== "undefined";

let dbInstance: DbInstance | null = null;

// ── Path resolution ──

const DEFAULT_DB_PATH = "database/lyre.db";

/** Resolve the database file path from env or default */
export function resolveDbPath(): string {
  const envPath = process.env.LYRE_DB;
  if (envPath) return envPath;
  return DEFAULT_DB_PATH;
}

/** Ensure parent directory exists (skip for :memory:) */
export function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Schema bootstrap (raw SQL) ──

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

// ── Database creation ──

/**
 * Open a raw SQLite connection, apply PRAGMAs and schema bootstrap,
 * then wrap with Drizzle ORM.
 */
function openAndInit(dbPath: string): DbInstance {
  ensureDir(dbPath);

  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/bun-sqlite");
    const sqlite = new Database(dbPath);
    sqlite.exec(INIT_SQL);
    return drizzle(sqlite, { schema });
  }

  // Node.js runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const sqlite = new BetterSqlite(dbPath);
  sqlite.exec(INIT_SQL);
  return drizzle(sqlite, { schema });
}

// ── Test database ──

function isTestEnv(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test"
  );
}

function createTestDb(): void {
  dbInstance = openAndInit(":memory:");
}

// ── Production database ──

function getDb(): DbInstance {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();
  dbInstance = openAndInit(dbPath);
  return dbInstance;
}

// ── Reset (for E2E tests) ──

export function resetDb(): void {
  if (!isTestEnv() && process.env.PLAYWRIGHT !== "1") {
    throw new Error("resetDb() can only be called in test environments");
  }

  if (!dbInstance) return;

  // Delete in reverse FK order
  const tables = [
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
      // Table may not exist yet
    }
  }
}

// ── Proxy export ──

export const db = new Proxy({} as DbInstance, {
  get(_, prop) {
    if (isTestEnv()) {
      if (!dbInstance) createTestDb();
      return dbInstance[prop];
    }
    const currentDb = getDb();
    return currentDb[prop];
  },
});
