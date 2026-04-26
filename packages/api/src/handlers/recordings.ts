/**
 * Handlers for `/api/recordings` and its sub-routes.
 *
 * Notes:
 * - The `transcribe` and `summarize` sub-routes are NOT extracted as
 *   handlers — `transcribe` depends on the legacy `JobManager` singleton
 *   (kept until Wave E per decision 8) and `summarize` returns a streaming
 *   text response (would need a `stream` branch in HandlerResponse, also
 *   not in plan). Their route files remain as thin direct implementations.
 */

import {
  recordingsRepo,
  transcriptionsRepo,
  jobsRepo,
  foldersRepo,
  tagsRepo,
} from "../db/repositories";
import {
  presignGet,
  deleteObject,
  listObjects,
  deleteObjects,
  makeResultKey,
} from "../services/oss";
import type {
  RecordingDetail,
  RecordingStatus,
  TranscriptionSentence,
} from "../lib/types";
import type { AsrTranscriptionResult, AsrTranscriptionWord } from "../services/asr";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  notFound,
  unauthorized,
  serverError,
  type HandlerResponse,
} from "./http";

const VALID_SORT_FIELDS = ["createdAt", "title", "duration", "fileSize"] as const;
const VALID_SORT_DIRECTIONS = ["asc", "desc"] as const;
const VALID_STATUSES = [
  "all",
  "uploaded",
  "transcribing",
  "completed",
  "failed",
] as const;
type SortField = (typeof VALID_SORT_FIELDS)[number];
type SortDirection = (typeof VALID_SORT_DIRECTIONS)[number];

function includes<T extends string>(arr: readonly T[], val: string): val is T {
  return (arr as readonly string[]).includes(val);
}

export interface ListRecordingsInput {
  query?: string | null;
  status?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
  page?: string | null;
  pageSize?: string | null;
  folderId?: string | null;
}

export function listRecordingsHandler(
  ctx: RuntimeContext,
  input: ListRecordingsInput,
): HandlerResponse {
  if (!ctx.user) return unauthorized();

  const statusParam = input.status ?? "all";
  const sortFieldParam = input.sortBy ?? "createdAt";
  const sortDirParam = input.sortDir ?? "desc";
  const status = includes(VALID_STATUSES, statusParam) ? statusParam : "all";
  const sortBy: SortField = includes(VALID_SORT_FIELDS, sortFieldParam)
    ? sortFieldParam
    : "createdAt";
  const sortDir: SortDirection = includes(VALID_SORT_DIRECTIONS, sortDirParam)
    ? sortDirParam
    : "desc";
  const page = Math.max(1, parseInt(input.page ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(input.pageSize ?? "10", 10) || 10),
  );

  const filterStatus = status === "all" ? undefined : (status as RecordingStatus);
  const filterQuery = input.query || undefined;

  const opts: Parameters<typeof recordingsRepo.findByUserId>[1] = {
    sortBy,
    sortDir,
    page,
    pageSize,
  };
  if (filterStatus !== undefined) opts.status = filterStatus;
  if (filterQuery !== undefined) opts.query = filterQuery;
  if (input.folderId === "unfiled") {
    opts.folderId = null;
  } else if (input.folderId) {
    opts.folderId = input.folderId;
  }

  const { items, total } = recordingsRepo.findByUserId(ctx.user.id, opts);
  const userFolders = foldersRepo.findByUserId(ctx.user.id);
  const folderMap = new Map(userFolders.map((f) => [f.id, f]));

  const recordings = items.map((row) => ({
    ...row,
    folder: row.folderId ? folderMap.get(row.folderId) ?? null : null,
    resolvedTags: tagsRepo.findTagsForRecording(row.id),
  }));

  const totalPages = Math.ceil(total / pageSize);
  return json({ items: recordings, total, page, pageSize, totalPages });
}

export interface CreateRecordingInput {
  id?: string;
  title?: string;
  description?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  format?: string;
  sampleRate?: number;
  ossKey?: string;
  tags?: string[];
  tagIds?: string[];
  recordedAt?: number;
  folderId?: string | null;
}

export function createRecordingHandler(
  ctx: RuntimeContext,
  body: CreateRecordingInput,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  if (!body.title || !body.fileName || !body.ossKey) {
    return badRequest("Missing required fields: title, fileName, ossKey");
  }
  const id = body.id ?? crypto.randomUUID();
  try {
    const recording = recordingsRepo.create({
      id,
      userId: ctx.user.id,
      title: body.title,
      description: body.description ?? null,
      fileName: body.fileName,
      fileSize: body.fileSize ?? null,
      duration: body.duration ?? null,
      format: body.format ?? null,
      sampleRate: body.sampleRate ?? null,
      ossKey: body.ossKey,
      status: "uploaded",
      recordedAt: body.recordedAt ?? null,
      folderId: body.folderId ?? null,
    });
    const tagIds = body.tagIds ?? body.tags ?? [];
    if (tagIds.length > 0) {
      tagsRepo.setTagsForRecording(recording.id, tagIds);
    }
    return json(
      {
        ...recording,
        resolvedTags: tagsRepo.findTagsForRecording(recording.id),
      },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(`Failed to create recording: ${message}`);
  }
}

export function getRecordingHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const recording = recordingsRepo.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const dbTranscription = transcriptionsRepo.findByRecordingId(id);
  const latestJob = jobsRepo.findLatestByRecordingId(id) ?? null;
  const transcription = dbTranscription
    ? {
        ...dbTranscription,
        sentences: transcriptionsRepo.parseSentences(
          dbTranscription.sentences,
        ) as TranscriptionSentence[],
      }
    : null;
  const detail: RecordingDetail = {
    ...recording,
    transcription,
    latestJob,
    folder: recording.folderId
      ? foldersRepo.findById(recording.folderId) ?? null
      : null,
    resolvedTags: tagsRepo.findTagsForRecording(id),
  };
  return json(detail);
}

export interface UpdateRecordingInput {
  title?: string;
  description?: string | null;
  notes?: string | null;
  folderId?: string | null;
  recordedAt?: number | null;
  tagIds?: string[];
}

export function updateRecordingHandler(
  ctx: RuntimeContext,
  id: string,
  body: UpdateRecordingInput,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const existing = recordingsRepo.findById(id);
  if (!existing || existing.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const updates: Parameters<typeof recordingsRepo.update>[1] = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.folderId !== undefined) updates.folderId = body.folderId;
  if (body.recordedAt !== undefined) updates.recordedAt = body.recordedAt;

  const updated = recordingsRepo.update(id, updates);
  if (!updated) return serverError("Failed to update recording");
  if (body.tagIds !== undefined) {
    tagsRepo.setTagsForRecording(id, body.tagIds);
  }
  return json({ ...updated, resolvedTags: tagsRepo.findTagsForRecording(id) });
}

/**
 * Delete a recording (DB + best-effort OSS cleanup).
 * OSS deletes are fire-and-forget — we don't await them so the response
 * returns quickly even on slow networks.
 */
export async function deleteRecordingHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const existing = recordingsRepo.findById(id);
  if (!existing || existing.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const jobs = jobsRepo.findByRecordingId(id);
  const jobIds = jobs.map((j) => j.id);

  recordingsRepo.deleteCascade(id);

  if (existing.ossKey) {
    deleteObject(existing.ossKey, undefined, ctx.env).catch(() => {
      console.warn(`Failed to delete OSS object: ${existing.ossKey}`);
    });
  }
  for (const jobId of jobIds) {
    cleanupResultObjects(jobId, ctx).catch(() => {
      console.warn(`Failed to delete OSS result objects for job: ${jobId}`);
    });
  }
  return json({ deleted: true });
}

const MAX_BATCH_SIZE = 100;

export async function batchDeleteRecordingsHandler(
  ctx: RuntimeContext,
  body: { ids?: unknown },
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return badRequest("Missing or empty ids array");
  }
  const ids = body.ids as string[];
  if (ids.length > MAX_BATCH_SIZE) {
    return badRequest(`Batch size exceeds maximum of ${MAX_BATCH_SIZE}`);
  }
  const ownedIds: string[] = [];
  const ossKeys: string[] = [];
  const jobIds: string[] = [];
  for (const id of ids) {
    const rec = recordingsRepo.findById(id);
    if (rec && rec.userId === ctx.user.id) {
      ownedIds.push(id);
      if (rec.ossKey) ossKeys.push(rec.ossKey);
      for (const job of jobsRepo.findByRecordingId(id)) {
        jobIds.push(job.id);
      }
    }
  }
  if (ownedIds.length === 0) return json({ deleted: 0 });

  const deleted = recordingsRepo.deleteCascadeMany(ownedIds);
  for (const key of ossKeys) {
    deleteObject(key, undefined, ctx.env).catch(() => {
      console.warn(`Failed to delete OSS object: ${key}`);
    });
  }
  for (const jobId of jobIds) {
    cleanupResultObjects(jobId, ctx).catch(() => {
      console.warn(`Failed to delete OSS result objects for job: ${jobId}`);
    });
  }
  return json({ deleted });
}

async function cleanupResultObjects(
  jobId: string,
  ctx: RuntimeContext,
): Promise<void> {
  const prefix = `results/${jobId}/`;
  const objects = await listObjects(prefix, undefined, ctx.env);
  if (objects.length === 0) return;
  await deleteObjects(
    objects.map((o) => o.key),
    undefined,
    ctx.env,
  );
}

export function playUrlHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const recording = recordingsRepo.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const playUrl = presignGet(recording.ossKey, 3600, undefined, undefined, ctx.env);
  return json({ playUrl });
}

export function downloadUrlHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const recording = recordingsRepo.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const downloadUrl = presignGet(
    recording.ossKey,
    3600,
    {
      "response-content-disposition": `attachment; filename="${encodeURIComponent(recording.fileName)}"`,
    },
    undefined,
    ctx.env,
  );
  return json({ downloadUrl });
}

export interface SentenceWords {
  sentenceId: number;
  words: AsrTranscriptionWord[];
}

export async function wordsHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const recording = recordingsRepo.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const job = jobsRepo.findLatestByRecordingId(id);
  if (!job || job.status !== "SUCCEEDED") {
    return notFound("No completed transcription found");
  }
  const ossKey = makeResultKey(job.id, "transcription.json");
  const ossUrl = presignGet(ossKey, 300, undefined, undefined, ctx.env);

  try {
    const response = await fetch(ossUrl);
    if (!response.ok) {
      return json({ error: "Failed to fetch transcription data from storage" }, 502);
    }
    const raw = (await response.json()) as AsrTranscriptionResult;
    const transcript = raw.transcripts[0];
    if (!transcript) return json({ sentences: [] });

    const sentences: SentenceWords[] = transcript.sentences.map((s) => ({
      sentenceId: s.sentence_id,
      words: s.words.map((w) => ({
        begin_time: w.begin_time,
        end_time: w.end_time,
        text: w.text,
        punctuation: w.punctuation,
      })),
    }));
    return json({ sentences });
  } catch {
    return serverError("Failed to load word data");
  }
}
