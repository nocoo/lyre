/**
 * In-memory SQLite test database.
 *
 * Provides a Drizzle handle backed by `better-sqlite3` for handler/service
 * unit tests under Vitest (Node runtime). Production code never touches
 * this — the worker uses D1.
 */

import Database from "better-sqlite3";
import type { Database as BetterSqliteDb } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import type { LyreDb } from "../../db/types";

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

PRAGMA foreign_keys=ON;
`;

const TABLES = [
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

let cached: { sqlite: BetterSqliteDb; db: LyreDb } | null = null;

export function getTestDb(): LyreDb {
  if (cached) return cached.db;
  const sqlite = new Database(":memory:");
  sqlite.exec(INIT_SQL);
  const db = drizzle(sqlite, { schema }) as unknown as LyreDb;
  cached = { sqlite, db };
  return db;
}

export function resetTestDb(): void {
  if (!cached) {
    getTestDb();
    return;
  }
  for (const t of TABLES) {
    try {
      cached.sqlite.exec(`DELETE FROM ${t}`);
    } catch {
      /* table may not exist yet */
    }
  }
}
