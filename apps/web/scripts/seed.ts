#!/usr/bin/env bun
/**
 * Seed script — populates a database with demo data.
 *
 * SAFETY: This script REFUSES to operate on the default production database
 * (database/lyre.db). You must explicitly set LYRE_DB to a safe target:
 *
 *   LYRE_DB=database/lyre.seed.db bun scripts/seed.ts
 *
 * The seeded data includes:
 *   - 1 demo user
 *   - 3 recordings (uploaded, completed, failed)
 *   - 2 transcription jobs (1 SUCCEEDED, 1 FAILED)
 *   - 1 transcription with sentences
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOCKED_TARGETS = ["database/lyre.db"];

function assertNotProduction(): void {
  const target = process.env.LYRE_DB;
  if (!target) {
    console.error(
      "BLOCKED: LYRE_DB is not set. This script defaults to database/lyre.db (production),\n" +
        "   which would DESTROY all real data.\n\n" +
        "   To seed a dev database:\n" +
        "     LYRE_DB=database/lyre.seed.db bun scripts/seed.ts\n",
    );
    process.exit(1);
  }

  if (BLOCKED_TARGETS.includes(target)) {
    console.error(
      `BLOCKED: Refusing to seed "${target}" — this is a protected database.\n\n` +
        "   To seed a dev database:\n" +
        "     LYRE_DB=database/lyre.seed.db bun scripts/seed.ts\n",
    );
    process.exit(1);
  }
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

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  duration REAL,
  format TEXT,
  sample_rate INTEGER,
  oss_key TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('uploaded','transcribing','completed','failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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

function seed() {
  assertNotProduction();

  const dbPath = resolve(PROJECT_ROOT, process.env.LYRE_DB!);
  console.log(`Seeding database: ${dbPath}`);

  // Remove existing file for clean seed
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    console.log("Removed existing database file.");
  }

  // Ensure parent directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.exec(INIT_SQL);
  console.log("Schema initialized.");

  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  const twoDaysAgo = now - 2 * 86400_000;
  const oneWeekAgo = now - 7 * 86400_000;

  // ── 1. Demo user ──
  const userId = "seed-user-001";
  console.log("Creating demo user...");
  db.run(
    `INSERT INTO users (id, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, "demo@lyre.app", "Demo User", null, oneWeekAgo, oneWeekAgo],
  );

  // ── 2. Recordings ──
  console.log("Creating recordings...");

  // Recording 1: completed with transcription
  const rec1Id = "seed-rec-001";
  db.run(
    `INSERT INTO recordings (id, user_id, title, description, file_name, file_size, duration, format, sample_rate, oss_key, tags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec1Id,
      userId,
      "Team standup meeting",
      "Daily standup recording from Monday",
      "standup-2026-02-16.mp3",
      8_500_000,
      1245.5,
      "mp3",
      44100,
      `recordings/${userId}/${rec1Id}/standup-2026-02-16.mp3`,
      JSON.stringify(["meeting", "standup"]),
      "completed",
      twoDaysAgo,
      oneHourAgo,
    ],
  );

  // Recording 2: just uploaded, no transcription
  const rec2Id = "seed-rec-002";
  db.run(
    `INSERT INTO recordings (id, user_id, title, description, file_name, file_size, duration, format, sample_rate, oss_key, tags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec2Id,
      userId,
      "Product review interview",
      "Interview with customer about product feedback",
      "interview-customer-01.mp3",
      15_200_000,
      2410.0,
      "mp3",
      48000,
      `recordings/${userId}/${rec2Id}/interview-customer-01.mp3`,
      JSON.stringify(["interview", "customer"]),
      "uploaded",
      oneHourAgo,
      oneHourAgo,
    ],
  );

  // Recording 3: failed transcription
  const rec3Id = "seed-rec-003";
  db.run(
    `INSERT INTO recordings (id, user_id, title, description, file_name, file_size, duration, format, sample_rate, oss_key, tags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec3Id,
      userId,
      "Corrupted audio sample",
      null,
      "broken-audio.mp3",
      512_000,
      null,
      "mp3",
      null,
      `recordings/${userId}/${rec3Id}/broken-audio.mp3`,
      JSON.stringify([]),
      "failed",
      oneWeekAgo,
      twoDaysAgo,
    ],
  );

  // ── 3. Transcription jobs ──
  console.log("Creating transcription jobs...");

  // Succeeded job for rec1
  const jobId = "seed-job-001";
  db.run(
    `INSERT INTO transcription_jobs (id, recording_id, task_id, request_id, status, submit_time, end_time, usage_seconds, error_message, result_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      jobId,
      rec1Id,
      "seed-dashscope-task-001",
      "seed-request-001",
      "SUCCEEDED",
      new Date(twoDaysAgo).toISOString(),
      new Date(twoDaysAgo + 60_000).toISOString(),
      1246,
      null,
      null,
      twoDaysAgo,
      twoDaysAgo + 60_000,
    ],
  );

  // Failed job for rec3
  db.run(
    `INSERT INTO transcription_jobs (id, recording_id, task_id, request_id, status, submit_time, end_time, usage_seconds, error_message, result_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "seed-job-002",
      rec3Id,
      "seed-dashscope-task-002",
      "seed-request-002",
      "FAILED",
      new Date(twoDaysAgo).toISOString(),
      new Date(twoDaysAgo + 5_000).toISOString(),
      null,
      "Audio file is corrupted or in an unsupported format",
      null,
      twoDaysAgo,
      twoDaysAgo + 5_000,
    ],
  );

  // ── 4. Transcription (for rec1) ──
  console.log("Creating transcription...");
  const sentences = [
    {
      sentence_id: 0,
      begin_time: 0,
      end_time: 5200,
      text: "Good morning everyone, let's get started with the standup.",
      language: "en",
      emotion: "neutral",
    },
    {
      sentence_id: 1,
      begin_time: 5500,
      end_time: 12800,
      text: "Yesterday I finished the API integration and deployed it to staging.",
      language: "en",
      emotion: "neutral",
    },
    {
      sentence_id: 2,
      begin_time: 13200,
      end_time: 19500,
      text: "Today I'm going to work on the dashboard charts and unit tests.",
      language: "en",
      emotion: "neutral",
    },
    {
      sentence_id: 3,
      begin_time: 20000,
      end_time: 25300,
      text: "No blockers for me. Who wants to go next?",
      language: "en",
      emotion: "happy",
    },
  ];
  const fullText = sentences.map((s) => s.text).join(" ");

  db.run(
    `INSERT INTO transcriptions (id, recording_id, job_id, full_text, sentences, language, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "seed-trans-001",
      rec1Id,
      jobId,
      fullText,
      JSON.stringify(sentences),
      "en",
      twoDaysAgo + 60_000,
      twoDaysAgo + 60_000,
    ],
  );

  db.close();

  // ── Summary ──
  console.log("\nSeed completed!");
  console.log("  Users: 1");
  console.log("  Recordings: 3 (1 completed, 1 uploaded, 1 failed)");
  console.log("  Jobs: 2 (1 SUCCEEDED, 1 FAILED)");
  console.log("  Transcriptions: 1");
}

seed();
