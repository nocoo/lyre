/**
 * Data backup service.
 *
 * Core logic for exporting and importing full user data backups.
 * Separated from the API route for testability.
 */

import { db } from "@/db/index";
import {
  foldersRepo,
  tagsRepo,
  recordingsRepo,
  jobsRepo,
  transcriptionsRepo,
  deviceTokensRepo,
  settingsRepo,
} from "@/db/repositories";
import {
  folders,
  tags,
  recordings,
  transcriptionJobs,
  transcriptions,
  recordingTags,
  deviceTokens,
  settings,
} from "@/db/schema";
import type { DbUser } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { APP_VERSION } from "@/lib/version";

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

export function exportBackup(user: DbUser): BackupData {
  const userFolders = foldersRepo.findByUserId(user.id);
  const userTags = tagsRepo.findByUserId(user.id);
  const userRecordings = recordingsRepo.findAll(user.id);
  const userDeviceTokens = deviceTokensRepo.findByUserId(user.id);
  const userSettings = settingsRepo.findByUserId(user.id);

  const allJobs: BackupData["transcriptionJobs"] = [];
  const allTranscriptions: BackupData["transcriptions"] = [];
  const allRecordingTags: BackupData["recordingTags"] = [];

  for (const rec of userRecordings) {
    const jobs = jobsRepo.findByRecordingId(rec.id);
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

    const transcription = transcriptionsRepo.findByRecordingId(rec.id);
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

    const tagIds = tagsRepo.findTagIdsForRecording(rec.id);
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

export function importBackup(
  userId: string,
  backup: BackupData,
): ImportCounts {
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

  db.transaction((tx: typeof db) => {
    // 1. Folders
    for (const f of backup.folders) {
      const existing = foldersRepo.findByIdAndUser(f.id, userId);
      if (existing) {
        tx.update(folders)
          .set({
            name: f.name,
            icon: f.icon,
            updatedAt: f.updatedAt,
          })
          .where(eq(folders.id, f.id))
          .run();
      } else {
        tx.insert(folders)
          .values({
            id: f.id,
            userId,
            name: f.name,
            icon: f.icon,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })
          .run();
      }
      counts.folders++;
    }

    // 2. Tags
    for (const t of backup.tags) {
      const existing = tagsRepo.findByIdAndUser(t.id, userId);
      if (existing) {
        tx.update(tags)
          .set({ name: t.name })
          .where(eq(tags.id, t.id))
          .run();
      } else {
        tx.insert(tags)
          .values({
            id: t.id,
            userId,
            name: t.name,
            createdAt: t.createdAt,
          })
          .run();
      }
      counts.tags++;
    }

    // 3. Recordings
    for (const r of backup.recordings) {
      const existing = recordingsRepo.findById(r.id);
      if (existing) {
        tx.update(recordings)
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
          .where(eq(recordings.id, r.id))
          .run();
      } else {
        tx.insert(recordings)
          .values({
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
          })
          .run();
      }
      counts.recordings++;
    }

    // 4. Transcription jobs
    for (const j of backup.transcriptionJobs) {
      const existing = jobsRepo.findById(j.id);
      if (existing) {
        tx.update(transcriptionJobs)
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
          .where(eq(transcriptionJobs.id, j.id))
          .run();
      } else {
        tx.insert(transcriptionJobs)
          .values({
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
          })
          .run();
      }
      counts.transcriptionJobs++;
    }

    // 5. Transcriptions
    for (const t of backup.transcriptions) {
      const existing = transcriptionsRepo.findById(t.id);
      if (existing) {
        tx.update(transcriptions)
          .set({
            recordingId: t.recordingId,
            jobId: t.jobId,
            fullText: t.fullText,
            sentences: t.sentences,
            language: t.language,
            updatedAt: t.updatedAt,
          })
          .where(eq(transcriptions.id, t.id))
          .run();
      } else {
        tx.insert(transcriptions)
          .values({
            id: t.id,
            recordingId: t.recordingId,
            jobId: t.jobId,
            fullText: t.fullText,
            sentences: t.sentences,
            language: t.language,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          })
          .run();
      }
      counts.transcriptions++;
    }

    // 6. Recording-tag associations (delete existing first, then re-insert)
    const recordingIdsInBackup = new Set(
      backup.recordingTags.map((rt) => rt.recordingId),
    );
    for (const recId of recordingIdsInBackup) {
      tx.delete(recordingTags)
        .where(eq(recordingTags.recordingId, recId))
        .run();
    }
    for (const rt of backup.recordingTags) {
      tx.insert(recordingTags)
        .values({ recordingId: rt.recordingId, tagId: rt.tagId })
        .run();
      counts.recordingTags++;
    }

    // 7. Device tokens
    for (const dt of backup.deviceTokens) {
      const existing = deviceTokensRepo.findById(dt.id);
      if (existing) {
        tx.update(deviceTokens)
          .set({
            name: dt.name,
            tokenHash: dt.tokenHash,
            lastUsedAt: dt.lastUsedAt,
          })
          .where(eq(deviceTokens.id, dt.id))
          .run();
      } else {
        tx.insert(deviceTokens)
          .values({
            id: dt.id,
            userId,
            name: dt.name,
            tokenHash: dt.tokenHash,
            lastUsedAt: dt.lastUsedAt,
            createdAt: dt.createdAt,
          })
          .run();
      }
      counts.deviceTokens++;
    }

    // 8. Settings
    for (const s of backup.settings) {
      const existing = settingsRepo.findByKey(userId, s.key);
      if (existing) {
        tx.update(settings)
          .set({ value: s.value, updatedAt: s.updatedAt })
          .where(
            and(eq(settings.userId, userId), eq(settings.key, s.key)),
          )
          .run();
      } else {
        tx.insert(settings)
          .values({
            userId,
            key: s.key,
            value: s.value,
            updatedAt: s.updatedAt,
          })
          .run();
      }
      counts.settings++;
    }
  });

  return counts;
}

// ── Push to Backy ──

export interface BackyCredentials {
  webhookUrl: string;
  apiKey: string;
}

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
): Promise<BackyPushResult> {
  const start = Date.now();
  const backup = exportBackup(user);
  const json = JSON.stringify(backup, null, 2);

  const environment =
    process.env.NODE_ENV === "production" ? "prod" : "dev";

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
