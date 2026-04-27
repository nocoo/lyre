/**
 * Data backup service.
 *
 * Core logic for exporting and importing full user data backups.
 * Separated from the API route for testability.
 */

import type { LyreDb } from "../db/types";

/**
 * Lazy-load the legacy sqlite singleton — keeps `bun:sqlite` /
 * `better-sqlite3` out of the worker bundle when callers always pass
 * an explicit `db`.
 */
function getDefaultDb(): LyreDb {
  const path = "../" + "db";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const req: (id: string) => unknown =
    typeof g.require === "function"
      ? g.require
      : // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require("mo" + "dule") as { createRequire: (u: string) => (id: string) => unknown }).createRequire(import.meta.url);
  return (req(path) as typeof import("../db")).db;
}
import {
  foldersRepo,
  tagsRepo,
  recordingsRepo,
  jobsRepo,
  transcriptionsRepo,
  deviceTokensRepo,
  settingsRepo,
  makeFoldersRepo,
  makeTagsRepo,
  makeRecordingsRepo,
  makeJobsRepo,
  makeTranscriptionsRepo,
  makeDeviceTokensRepo,
  makeSettingsRepo,
} from "../db/repositories";
import { runBatch } from "../db/drivers/batch";
import {
  folders,
  tags,
  recordings,
  transcriptionJobs,
  transcriptions,
  recordingTags,
  deviceTokens,
  settings,
} from "../db/schema";
import type { DbUser } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { APP_VERSION } from "../lib/version";
import type { BackyCredentials } from "./backy";
import { getEnvironment } from "./backy";
import type { LyreEnv } from "../runtime/env";

// ── Backup format ──

export interface BackupData {
  version: 1;
  exportedAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    createdAt: number;
    updatedAt: number;
  };
  folders: Array<{
    id: string;
    name: string;
    icon: string;
    createdAt: number;
    updatedAt: number;
  }>;
  tags: Array<{
    id: string;
    name: string;
    createdAt: number;
  }>;
  recordings: Array<{
    id: string;
    folderId: string | null;
    title: string;
    description: string | null;
    fileName: string;
    fileSize: number | null;
    duration: number | null;
    format: string | null;
    sampleRate: number | null;
    ossKey: string;
    tags: string;
    notes: string | null;
    aiSummary: string | null;
    recordedAt: number | null;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  transcriptionJobs: Array<{
    id: string;
    recordingId: string;
    taskId: string;
    requestId: string | null;
    status: string;
    submitTime: string | null;
    endTime: string | null;
    usageSeconds: number | null;
    errorMessage: string | null;
    resultUrl: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  transcriptions: Array<{
    id: string;
    recordingId: string;
    jobId: string;
    fullText: string;
    sentences: string;
    language: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  recordingTags: Array<{
    recordingId: string;
    tagId: string;
  }>;
  deviceTokens: Array<{
    id: string;
    name: string;
    tokenHash: string;
    lastUsedAt: number | null;
    createdAt: number;
  }>;
  settings: Array<{
    key: string;
    value: string;
    updatedAt: number;
  }>;
}

// ── Validation ──

export function validateBackup(data: unknown): string | null {
  if (!data || typeof data !== "object") return "expected an object";
  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) return "unsupported version (expected 1)";
  if (typeof obj.exportedAt !== "string") return "missing exportedAt";

  const requiredArrays = [
    "folders",
    "tags",
    "recordings",
    "transcriptionJobs",
    "transcriptions",
    "recordingTags",
    "deviceTokens",
    "settings",
  ] as const;

  for (const key of requiredArrays) {
    if (!Array.isArray(obj[key])) return `missing or invalid ${key} array`;
  }

  if (!obj.user || typeof obj.user !== "object") return "missing user object";

  return null;
}

// ── Export ──

export async function exportBackup(
  user: DbUser,
  db?: LyreDb,
): Promise<BackupData> {
  const folders_ = db ? makeFoldersRepo(db) : foldersRepo;
  const tags_ = db ? makeTagsRepo(db) : tagsRepo;
  const recordings_ = db ? makeRecordingsRepo(db) : recordingsRepo;
  const jobs_ = db ? makeJobsRepo(db) : jobsRepo;
  const transcriptions_ = db ? makeTranscriptionsRepo(db) : transcriptionsRepo;
  const deviceTokens_ = db ? makeDeviceTokensRepo(db) : deviceTokensRepo;
  const settings_ = db ? makeSettingsRepo(db) : settingsRepo;

  const userFolders = await folders_.findByUserId(user.id);
  const userTags = await tags_.findByUserId(user.id);
  const userRecordings = await recordings_.findAll(user.id);
  const userDeviceTokens = await deviceTokens_.findByUserId(user.id);
  const userSettings = await settings_.findByUserId(user.id);

  const allJobs: BackupData["transcriptionJobs"] = [];
  const allTranscriptions: BackupData["transcriptions"] = [];
  const allRecordingTags: BackupData["recordingTags"] = [];

  for (const rec of userRecordings) {
    const jobs = await jobs_.findByRecordingId(rec.id);
    for (const job of jobs) {
      allJobs.push({
        id: job.id,
        recordingId: job.recordingId,
        taskId: job.taskId,
        requestId: job.requestId,
        status: job.status,
        submitTime: job.submitTime,
        endTime: job.endTime,
        usageSeconds: job.usageSeconds,
        errorMessage: job.errorMessage,
        resultUrl: job.resultUrl,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
    }

    const transcription = await transcriptions_.findByRecordingId(rec.id);
    if (transcription) {
      allTranscriptions.push({
        id: transcription.id,
        recordingId: transcription.recordingId,
        jobId: transcription.jobId,
        fullText: transcription.fullText,
        sentences: transcription.sentences,
        language: transcription.language,
        createdAt: transcription.createdAt,
        updatedAt: transcription.updatedAt,
      });
    }

    const tagIds = await tags_.findTagIdsForRecording(rec.id);
    for (const tagId of tagIds) {
      allRecordingTags.push({ recordingId: rec.id, tagId });
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    folders: userFolders.map((f) => ({
      id: f.id,
      name: f.name,
      icon: f.icon,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
    tags: userTags.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
    })),
    recordings: userRecordings.map((r) => ({
      id: r.id,
      folderId: r.folderId,
      title: r.title,
      description: r.description,
      fileName: r.fileName,
      fileSize: r.fileSize,
      duration: r.duration,
      format: r.format,
      sampleRate: r.sampleRate,
      ossKey: r.ossKey,
      tags: r.tags,
      notes: r.notes,
      aiSummary: r.aiSummary,
      recordedAt: r.recordedAt,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    transcriptionJobs: allJobs,
    transcriptions: allTranscriptions,
    recordingTags: allRecordingTags,
    deviceTokens: userDeviceTokens.map((dt) => ({
      id: dt.id,
      name: dt.name,
      tokenHash: dt.tokenHash,
      lastUsedAt: dt.lastUsedAt,
      createdAt: dt.createdAt,
    })),
    settings: userSettings.map((s) => ({
      key: s.key,
      value: s.value,
      updatedAt: s.updatedAt,
    })),
  };
}

// ── Import ──

/**
 * Import backup data into the database for the given user.
 * Uses upsert semantics inside a transaction.
 *
 * The data is re-keyed to the current user's ID,
 * regardless of which user originally exported it.
 */
export interface ImportCounts {
  folders: number;
  tags: number;
  recordings: number;
  transcriptionJobs: number;
  transcriptions: number;
  recordingTags: number;
  deviceTokens: number;
  settings: number;
}

export async function importBackup(
  userId: string,
  backup: BackupData,
  dbArg?: LyreDb,
): Promise<ImportCounts> {
  const db = (dbArg ?? getDefaultDb()) as LyreDb;
  const folders_ = dbArg ? makeFoldersRepo(dbArg) : foldersRepo;
  const tags_ = dbArg ? makeTagsRepo(dbArg) : tagsRepo;
  const recordings_ = dbArg ? makeRecordingsRepo(dbArg) : recordingsRepo;
  const jobs_ = dbArg ? makeJobsRepo(dbArg) : jobsRepo;
  const transcriptions_ = dbArg ? makeTranscriptionsRepo(dbArg) : transcriptionsRepo;
  const deviceTokens_ = dbArg ? makeDeviceTokensRepo(dbArg) : deviceTokensRepo;
  const settings_ = dbArg ? makeSettingsRepo(dbArg) : settingsRepo;

  const counts: ImportCounts = {
    folders: 0,
    tags: 0,
    recordings: 0,
    transcriptionJobs: 0,
    transcriptions: 0,
    recordingTags: 0,
    deviceTokens: 0,
    settings: 0,
  };

  // Pre-resolve all existence checks; D1 batch has no interactive reads.
  const folderExists = new Map<string, boolean>();
  for (const f of backup.folders) {
    folderExists.set(f.id, !!(await folders_.findByIdAndUser(f.id, userId)));
  }
  const tagExists = new Map<string, boolean>();
  for (const t of backup.tags) {
    tagExists.set(t.id, !!(await tags_.findByIdAndUser(t.id, userId)));
  }
  const recordingExists = new Map<string, boolean>();
  for (const r of backup.recordings) {
    recordingExists.set(r.id, !!(await recordings_.findById(r.id)));
  }
  const jobExists = new Map<string, boolean>();
  for (const j of backup.transcriptionJobs) {
    jobExists.set(j.id, !!(await jobs_.findById(j.id)));
  }
  const transcriptionExists = new Map<string, boolean>();
  for (const t of backup.transcriptions) {
    transcriptionExists.set(t.id, !!(await transcriptions_.findById(t.id)));
  }
  const tokenExists = new Map<string, boolean>();
  for (const dt of backup.deviceTokens) {
    tokenExists.set(dt.id, !!(await deviceTokens_.findById(dt.id)));
  }
  const settingExists = new Map<string, boolean>();
  for (const s of backup.settings) {
    settingExists.set(s.key, !!(await settings_.findByKey(userId, s.key)));
  }

  await runBatch(db, (h) => {
    const stmts: ReturnType<typeof h.insert>[] = [];

    // 1. Folders
    for (const f of backup.folders) {
      if (folderExists.get(f.id)) {
        stmts.push(
          h
            .update(folders)
            .set({
              name: f.name,
              icon: f.icon,
              updatedAt: f.updatedAt,
            })
            .where(eq(folders.id, f.id)) as unknown as ReturnType<typeof h.insert>,
        );
      } else {
        stmts.push(
          h.insert(folders).values({
            id: f.id,
            userId,
            name: f.name,
            icon: f.icon,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          }),
        );
      }
      counts.folders++;
    }

    // 2. Tags
    for (const t of backup.tags) {
      if (tagExists.get(t.id)) {
        stmts.push(
          h
            .update(tags)
            .set({ name: t.name })
            .where(eq(tags.id, t.id)) as unknown as ReturnType<typeof h.insert>,
        );
      } else {
        stmts.push(
          h.insert(tags).values({
            id: t.id,
            userId,
            name: t.name,
            createdAt: t.createdAt,
          }),
        );
      }
      counts.tags++;
    }

    // 3. Recordings
    for (const r of backup.recordings) {
      if (recordingExists.get(r.id)) {
        stmts.push(
          h
            .update(recordings)
            .set({
              folderId: r.folderId,
              title: r.title,
              description: r.description,
              fileName: r.fileName,
              fileSize: r.fileSize,
              duration: r.duration,
              format: r.format,
              sampleRate: r.sampleRate,
              ossKey: r.ossKey,
              tags: r.tags,
              notes: r.notes,
              aiSummary: r.aiSummary,
              recordedAt: r.recordedAt,
              status: r.status,
              updatedAt: r.updatedAt,
            })
            .where(eq(recordings.id, r.id)) as unknown as ReturnType<typeof h.insert>,
        );
      } else {
        stmts.push(
          h.insert(recordings).values({
            id: r.id,
            userId,
            folderId: r.folderId,
            title: r.title,
            description: r.description,
            fileName: r.fileName,
            fileSize: r.fileSize,
            duration: r.duration,
            format: r.format,
            sampleRate: r.sampleRate,
            ossKey: r.ossKey,
            tags: r.tags,
            notes: r.notes,
            aiSummary: r.aiSummary,
            recordedAt: r.recordedAt,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }),
        );
      }
      counts.recordings++;
    }

    // 4. Transcription jobs
    for (const j of backup.transcriptionJobs) {
      if (jobExists.get(j.id)) {
        stmts.push(
          h
            .update(transcriptionJobs)
            .set({
              recordingId: j.recordingId,
              taskId: j.taskId,
              requestId: j.requestId,
              status: j.status,
              submitTime: j.submitTime,
              endTime: j.endTime,
              usageSeconds: j.usageSeconds,
              errorMessage: j.errorMessage,
              resultUrl: j.resultUrl,
              updatedAt: j.updatedAt,
            })
            .where(eq(transcriptionJobs.id, j.id)) as unknown as ReturnType<
            typeof h.insert
          >,
        );
      } else {
        stmts.push(
          h.insert(transcriptionJobs).values({
            id: j.id,
            recordingId: j.recordingId,
            taskId: j.taskId,
            requestId: j.requestId,
            status: j.status,
            submitTime: j.submitTime,
            endTime: j.endTime,
            usageSeconds: j.usageSeconds,
            errorMessage: j.errorMessage,
            resultUrl: j.resultUrl,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
          }),
        );
      }
      counts.transcriptionJobs++;
    }

    // 5. Transcriptions
    for (const t of backup.transcriptions) {
      if (transcriptionExists.get(t.id)) {
        stmts.push(
          h
            .update(transcriptions)
            .set({
              recordingId: t.recordingId,
              jobId: t.jobId,
              fullText: t.fullText,
              sentences: t.sentences,
              language: t.language,
              updatedAt: t.updatedAt,
            })
            .where(eq(transcriptions.id, t.id)) as unknown as ReturnType<
            typeof h.insert
          >,
        );
      } else {
        stmts.push(
          h.insert(transcriptions).values({
            id: t.id,
            recordingId: t.recordingId,
            jobId: t.jobId,
            fullText: t.fullText,
            sentences: t.sentences,
            language: t.language,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          }),
        );
      }
      counts.transcriptions++;
    }

    // 6. Recording-tag associations (delete existing first, then re-insert)
    const recordingIdsInBackup = new Set(
      backup.recordingTags.map((rt) => rt.recordingId),
    );
    for (const recId of recordingIdsInBackup) {
      stmts.push(
        h
          .delete(recordingTags)
          .where(eq(recordingTags.recordingId, recId)) as unknown as ReturnType<
          typeof h.insert
        >,
      );
    }
    for (const rt of backup.recordingTags) {
      stmts.push(
        h.insert(recordingTags).values({
          recordingId: rt.recordingId,
          tagId: rt.tagId,
        }),
      );
      counts.recordingTags++;
    }

    // 7. Device tokens
    for (const dt of backup.deviceTokens) {
      if (tokenExists.get(dt.id)) {
        stmts.push(
          h
            .update(deviceTokens)
            .set({
              name: dt.name,
              tokenHash: dt.tokenHash,
              lastUsedAt: dt.lastUsedAt,
            })
            .where(eq(deviceTokens.id, dt.id)) as unknown as ReturnType<
            typeof h.insert
          >,
        );
      } else {
        stmts.push(
          h.insert(deviceTokens).values({
            id: dt.id,
            userId,
            name: dt.name,
            tokenHash: dt.tokenHash,
            lastUsedAt: dt.lastUsedAt,
            createdAt: dt.createdAt,
          }),
        );
      }
      counts.deviceTokens++;
    }

    // 8. Settings
    for (const s of backup.settings) {
      if (settingExists.get(s.key)) {
        stmts.push(
          h
            .update(settings)
            .set({ value: s.value, updatedAt: s.updatedAt })
            .where(
              and(eq(settings.userId, userId), eq(settings.key, s.key)),
            ) as unknown as ReturnType<typeof h.insert>,
        );
      } else {
        stmts.push(
          h.insert(settings).values({
            userId,
            key: s.key,
            value: s.value,
            updatedAt: s.updatedAt,
          }),
        );
      }
      counts.settings++;
    }

    return stmts;
  });

  return counts;
}

// ── Push to Backy ──

export type { BackyCredentials } from "./backy";

export interface BackyPushResult {
  ok: boolean;
  status: number;
  body: unknown;
  request: {
    url: string;
    method: string;
    environment: string;
    tag: string;
    fileName: string;
    fileSizeBytes: number;
    backupStats: {
      recordings: number;
      transcriptions: number;
      folders: number;
      tags: number;
      jobs: number;
      settings: number;
    };
  };
  durationMs: number;
}

/**
 * Export user data and push it to the Backy backup service.
 *
 * Generates a JSON backup, builds a descriptive tag with version/date/stats,
 * and POSTs it as a multipart/form-data upload to the Backy webhook.
 */
export async function pushBackupToBacky(
  user: DbUser,
  credentials: BackyCredentials,
  // optional for back-compat with legacy tests; always pass ctx.env from handlers
  env?: LyreEnv,
  db?: LyreDb,
): Promise<BackyPushResult> {
  const start = Date.now();
  const backup = await exportBackup(user, db);
  const json = JSON.stringify(backup, null, 2);

  const environment = getEnvironment(env);

  const date = new Date().toISOString().slice(0, 10);
  const stats = [
    `${backup.recordings.length}rec`,
    `${backup.transcriptions.length}tr`,
    `${backup.folders.length}fld`,
    `${backup.tags.length}tag`,
  ].join("-");
  const tag = `v${APP_VERSION}-${date}-${stats}`;

  const filename = `lyre-backup-${date}.json`;
  const blob = new Blob([json], { type: "application/json" });

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("environment", environment);
  form.append("tag", tag);

  const requestMeta = {
    url: credentials.webhookUrl,
    method: "POST" as const,
    environment,
    tag,
    fileName: filename,
    fileSizeBytes: json.length,
    backupStats: {
      recordings: backup.recordings.length,
      transcriptions: backup.transcriptions.length,
      folders: backup.folders.length,
      tags: backup.tags.length,
      jobs: backup.transcriptionJobs.length,
      settings: backup.settings.length,
    },
  };

  let res: Response;
  try {
    res = await fetch(credentials.webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: form,
    });
  } catch (err) {
    // Network-level failure (DNS, TLS, connection refused, etc.)
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      body: { fetchError: message },
      request: requestMeta,
      durationMs: Date.now() - start,
    };
  }

  let body: unknown;
  const text = await res.text().catch(() => "");
  try {
    body = JSON.parse(text);
  } catch {
    body = text || null;
  }

  return {
    ok: res.ok,
    status: res.status,
    body,
    request: requestMeta,
    durationMs: Date.now() - start,
  };
}
