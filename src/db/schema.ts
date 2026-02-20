/**
 * Drizzle ORM schema for Lyre.
 *
 * All tables use text primary keys (UUIDs) and integer timestamps (Unix ms).
 * Tags are stored as JSON text arrays.
 * Transcription sentences are stored as JSON text.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ── Users ──

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DbUser = typeof users.$inferSelect;
export type NewDbUser = typeof users.$inferInsert;

// ── Recordings ──

export const recordings = sqliteTable("recordings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  duration: real("duration"), // seconds
  format: text("format"),
  sampleRate: integer("sample_rate"),
  ossKey: text("oss_key").notNull(),
  tags: text("tags").notNull().default("[]"), // JSON array
  status: text("status", {
    enum: ["uploaded", "transcribing", "completed", "failed"],
  }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DbRecording = typeof recordings.$inferSelect;
export type NewDbRecording = typeof recordings.$inferInsert;

// ── Transcription Jobs ──

export const transcriptionJobs = sqliteTable("transcription_jobs", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .references(() => recordings.id),
  taskId: text("task_id").notNull(), // DashScope task ID
  requestId: text("request_id"),
  status: text("status", {
    enum: ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"],
  }).notNull(),
  submitTime: text("submit_time"),
  endTime: text("end_time"),
  usageSeconds: integer("usage_seconds"),
  errorMessage: text("error_message"),
  resultUrl: text("result_url"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DbTranscriptionJob = typeof transcriptionJobs.$inferSelect;
export type NewDbTranscriptionJob = typeof transcriptionJobs.$inferInsert;

// ── Transcriptions ──

export const transcriptions = sqliteTable("transcriptions", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id")
    .notNull()
    .unique()
    .references(() => recordings.id),
  jobId: text("job_id")
    .notNull()
    .references(() => transcriptionJobs.id),
  fullText: text("full_text").notNull(),
  sentences: text("sentences").notNull().default("[]"), // JSON array
  language: text("language"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DbTranscription = typeof transcriptions.$inferSelect;
export type NewDbTranscription = typeof transcriptions.$inferInsert;

// ── Settings ──

export const settings = sqliteTable("settings", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DbSetting = typeof settings.$inferSelect;
export type NewDbSetting = typeof settings.$inferInsert;
