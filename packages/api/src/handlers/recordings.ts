/**
 * Handlers for `/api/recordings` and its sub-routes.
 *
 * Notes:
 * - The `summarize` sub-route is NOT extracted as a handler — it returns
 *   a streaming text response (would need a `stream` branch in
 *   HandlerResponse). Its route stays as a thin direct implementation in
 *   the host app (Worker route file / legacy Next.js route).
 * - `transcribeRecordingHandler` submits the ASR job and persists it but
 *   does NOT track via any in-process JobManager. On the new Worker the
 *   Cron Trigger drives polling (decision 8); on legacy Next.js the route
 *   wrapper still calls `getJobManager().track(job)` after the handler
 *   returns.
 */

import { makeRepos, type RecordingsRepo } from "../db/repositories";
import {
  presignGet,
  deleteObject,
  listObjects,
  deleteObjects,
  makeResultKey,
} from "../services/oss";
import { getAsrProvider } from "../services/asr-provider";
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

export async function listRecordingsHandler(
  ctx: RuntimeContext,
  input: ListRecordingsInput,
): Promise<HandlerResponse> {
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

  const repos = makeRepos(ctx.db);
  const opts: Parameters<RecordingsRepo["findByUserId"]>[1] = {
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

  const { items, total } = await repos.recordings.findByUserId(ctx.user.id, opts);
  const userFolders = await repos.folders.findByUserId(ctx.user.id);
  const folderMap = new Map(userFolders.map((f) => [f.id, f]));

  const mapped = await Promise.all(
    items.map(async (row) => ({
      ...row,
      folder: row.folderId ? folderMap.get(row.folderId) ?? null : null,
      resolvedTags: await repos.tags.findTagsForRecording(row.id),
    })),
  );

  const totalPages = Math.ceil(total / pageSize);
  return json({ items: mapped, total, page, pageSize, totalPages });
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

export async function createRecordingHandler(
  ctx: RuntimeContext,
  body: CreateRecordingInput,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  if (!body.title || !body.fileName || !body.ossKey) {
    return badRequest("Missing required fields: title, fileName, ossKey");
  }
  const id = body.id ?? crypto.randomUUID();
  const repos = makeRepos(ctx.db);
  try {
    const recording = await repos.recordings.create({
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
      await repos.tags.setTagsForRecording(recording.id, tagIds);
    }
    return json(
      {
        ...recording,
        resolvedTags: await repos.tags.findTagsForRecording(recording.id),
      },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(`Failed to create recording: ${message}`);
  }
}

export async function getRecordingHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const repos = makeRepos(ctx.db);
  const recording = await repos.recordings.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const dbTranscription = await repos.transcriptions.findByRecordingId(id);
  const latestJob = (await repos.jobs.findLatestByRecordingId(id)) ?? null;
  const transcription = dbTranscription
    ? {
        ...dbTranscription,
        sentences: repos.transcriptions.parseSentences(
          dbTranscription.sentences,
        ) as TranscriptionSentence[],
      }
    : null;
  const detail: RecordingDetail = {
    ...recording,
    transcription,
    latestJob,
    folder: recording.folderId
      ? (await repos.folders.findById(recording.folderId)) ?? null
      : null,
    resolvedTags: await repos.tags.findTagsForRecording(id),
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

export async function updateRecordingHandler(
  ctx: RuntimeContext,
  id: string,
  body: UpdateRecordingInput,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const repos = makeRepos(ctx.db);
  const existing = await repos.recordings.findById(id);
  if (!existing || existing.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const updates: Parameters<RecordingsRepo["update"]>[1] = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.folderId !== undefined) updates.folderId = body.folderId;
  if (body.recordedAt !== undefined) updates.recordedAt = body.recordedAt;

  const updated = await repos.recordings.update(id, updates);
  if (!updated) return serverError("Failed to update recording");
  if (body.tagIds !== undefined) {
    await repos.tags.setTagsForRecording(id, body.tagIds);
  }
  return json({
    ...updated,
    resolvedTags: await repos.tags.findTagsForRecording(id),
  });
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
  const repos = makeRepos(ctx.db);
  const existing = await repos.recordings.findById(id);
  if (!existing || existing.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const recordingJobs = await repos.jobs.findByRecordingId(id);
  const jobIds = recordingJobs.map((j) => j.id);

  await repos.recordings.deleteCascade(id);

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
  const repos = makeRepos(ctx.db);
  const ownedIds: string[] = [];
  const ossKeys: string[] = [];
  const jobIds: string[] = [];
  for (const id of ids) {
    const rec = await repos.recordings.findById(id);
    if (rec && rec.userId === ctx.user.id) {
      ownedIds.push(id);
      if (rec.ossKey) ossKeys.push(rec.ossKey);
      for (const job of await repos.jobs.findByRecordingId(id)) {
        jobIds.push(job.id);
      }
    }
  }
  if (ownedIds.length === 0) return json({ deleted: 0 });

  const deleted = await repos.recordings.deleteCascadeMany(ownedIds);
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

export async function playUrlHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { recordings } = makeRepos(ctx.db);
  const recording = await recordings.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const playUrl = presignGet(recording.ossKey, 3600, undefined, undefined, ctx.env);
  return json({ playUrl });
}

export async function downloadUrlHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { recordings } = makeRepos(ctx.db);
  const recording = await recordings.findById(id);
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
  const { recordings, jobs } = makeRepos(ctx.db);
  const recording = await recordings.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  const job = await jobs.findLatestByRecordingId(id);
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

/**
 * Submit an ASR transcription job for a recording.
 *
 * Returns the persisted job (HTTP 201). The caller is responsible for
 * driving polling: the new Worker relies on Cron Triggers
 * (`cronTickHandler`); the legacy Next.js route wrapper still calls
 * `getJobManager().track(job)` after this handler returns.
 */
export async function transcribeRecordingHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const repos = makeRepos(ctx.db);
  const recording = await repos.recordings.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Recording not found");
  }
  if (recording.status === "transcribing") {
    return json(
      { error: "Recording is already being transcribed" },
      409,
    );
  }

  try {
    const audioUrl = presignGet(
      recording.ossKey,
      3600,
      undefined,
      undefined,
      ctx.env,
    );
    const provider = getAsrProvider(ctx.env);
    const submitResult = await provider.submit(audioUrl);
    const job = await repos.jobs.create({
      id: crypto.randomUUID(),
      recordingId: id,
      taskId: submitResult.output.task_id,
      requestId: submitResult.request_id,
      status: submitResult.output.task_status,
    });
    await repos.recordings.update(id, { status: "transcribing" });
    return json(job, 201);
  } catch (error) {
    console.error("Failed to submit ASR job:", error);
    return serverError(
      `Failed to submit transcription job: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
