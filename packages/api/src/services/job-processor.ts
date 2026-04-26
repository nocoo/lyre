/**
 * Job processor service.
 *
 * Extracts the job polling and completion logic from the API route
 * into a reusable, testable service. This is the core engine that:
 *
 * 1. Polls a single job against the ASR provider
 * 2. On SUCCEEDED: fetches result, saves transcription, archives, auto-summarizes
 * 3. On FAILED: records error and updates recording status
 * 4. Returns the updated job and its new status
 *
 * This module has NO HTTP/Next.js dependencies — it operates purely on
 * repositories and the ASR provider, making it testable in isolation.
 */

import {
  jobsRepo,
  recordingsRepo,
  transcriptionsRepo,
  settingsRepo,
  makeJobsRepo,
  makeRecordingsRepo,
  makeTranscriptionsRepo,
  makeSettingsRepo,
} from "../db/repositories";
import type { LyreDb } from "../db/types";
import type { AsrProvider } from "./asr";
import { parseTranscriptionResult } from "./asr";
import { presignPut, makeResultKey } from "./oss";
import {
  resolveAiConfig,
  createAiModel,
  buildSummaryPrompt,
  type AiProvider,
  type SdkType,
} from "./ai";
import { generateText } from "ai";
import type { DbTranscriptionJob } from "../db/schema";
import type { JobStatus } from "../lib/types";
import { loadEnvFromProcess, type LyreEnv } from "../runtime/env";

// ── Types ──

export interface JobPollResult {
  job: DbTranscriptionJob;
  /** The status BEFORE this poll (null if job was already terminal). */
  previousStatus: JobStatus | null;
  /** Whether the status changed during this poll. */
  changed: boolean;
}

// ── Core poll function ──

/**
 * Poll a single job: check ASR provider for updates, process results on
 * terminal states, and persist all changes to the database.
 *
 * Returns the updated job and whether its status changed.
 * Throws on unrecoverable ASR provider errors (caller should handle).
 */
// `db` and `env` are optional for back-compat with legacy callers/tests;
// new worker entry points should always pass `ctx.db` and `ctx.env`.
export async function pollJob(
  job: DbTranscriptionJob,
  provider: AsrProvider,
  env?: LyreEnv,
  db?: LyreDb,
): Promise<JobPollResult> {
  const e = env ?? loadEnvFromProcess();
  const jobs = db ? makeJobsRepo(db) : jobsRepo;
  const recordings = db ? makeRecordingsRepo(db) : recordingsRepo;
  const transcriptions = db ? makeTranscriptionsRepo(db) : transcriptionsRepo;
  // Already terminal — nothing to do
  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return { job, previousStatus: null, changed: false };
  }

  const previousStatus = job.status;
  const pollResult = await provider.poll(job.taskId);
  const newStatus = pollResult.output.task_status;

  // Build update payload
  const updateData: Parameters<typeof jobs.update>[1] = {
    status: newStatus,
    requestId: pollResult.request_id,
  };

  if (pollResult.output.submit_time) {
    updateData.submitTime = pollResult.output.submit_time;
  }
  if (pollResult.output.end_time) {
    updateData.endTime = pollResult.output.end_time;
  }
  if (pollResult.usage?.seconds != null) {
    updateData.usageSeconds = pollResult.usage.seconds;
  }

  // Handle SUCCEEDED
  if (newStatus === "SUCCEEDED" && pollResult.output.result) {
    updateData.resultUrl = pollResult.output.result.transcription_url;

    try {
      const rawResult = await provider.fetchResult(
        pollResult.output.result.transcription_url,
      );
      const parsed = parseTranscriptionResult(rawResult);

      // Remove existing transcription if re-transcribing
      await transcriptions.deleteByRecordingId(job.recordingId);

      // Save transcription
      await transcriptions.create({
        id: crypto.randomUUID(),
        recordingId: job.recordingId,
        jobId: job.id,
        fullText: parsed.fullText,
        sentences: parsed.sentences,
        language: parsed.language,
      });

      // Archive raw result to OSS (best-effort)
      archiveRawResult(job.id, rawResult, e).catch((err) => {
        console.warn("Failed to archive raw ASR result to OSS:", err);
      });

      // Update recording status
      await recordings.update(job.recordingId, { status: "completed" });

      // Auto-summarize if enabled (best-effort)
      const recording = await recordings.findById(job.recordingId);
      if (recording) {
        autoSummarize(recording.userId, job.recordingId, parsed.fullText, db).catch(
          (err) => {
            console.warn("[auto-summarize] Failed:", err);
          },
        );
      }
    } catch (err) {
      console.error("Failed to process transcription result:", err);
      updateData.status = "FAILED";
      updateData.errorMessage =
        err instanceof Error
          ? `Result processing failed: ${err.message}`
          : "Result processing failed";
      await recordings.update(job.recordingId, { status: "failed" });
    }
  }

  // Handle FAILED
  if (newStatus === "FAILED") {
    updateData.errorMessage =
      pollResult.output.message ?? "Transcription failed";
    await recordings.update(job.recordingId, { status: "failed" });
  }

  const updatedJob = await jobs.update(job.id, updateData);
  const finalJob = updatedJob ?? job;

  return {
    job: finalJob,
    previousStatus,
    changed: finalJob.status !== previousStatus,
  };
}

// ── Helpers (moved from route) ──

/**
 * Archive the raw ASR result JSON to OSS.
 */
async function archiveRawResult(
  jobId: string,
  rawResult: unknown,
  env: LyreEnv,
): Promise<void> {
  if (env.SKIP_OSS_ARCHIVE === "1") return;

  const key = makeResultKey(jobId, "transcription.json");
  const body = JSON.stringify(rawResult);
  const contentType = "application/json";

  const uploadUrl = presignPut(key, contentType, 900, undefined, env);

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `OSS upload failed: ${response.status} ${response.statusText}`,
    );
  }
}

/**
 * Auto-summarize a recording after transcription completes.
 */
async function autoSummarize(
  userId: string,
  recordingId: string,
  fullText: string,
  db?: LyreDb,
): Promise<void> {
  const settings = db ? makeSettingsRepo(db) : settingsRepo;
  const recordings = db ? makeRecordingsRepo(db) : recordingsRepo;
  const all = await settings.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));

  if (map.get("ai.autoSummarize") !== "true") return;

  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";
  const baseURL = map.get("ai.baseURL") ?? "";
  const sdkType = map.get("ai.sdkType") ?? "";

  if (!provider || !apiKey) return;

  const config = resolveAiConfig({
    provider: provider as AiProvider,
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
    ...(sdkType ? { sdkType: sdkType as SdkType } : {}),
  });

  const client = createAiModel(config);
  const prompt = buildSummaryPrompt(fullText);

  const { text } = await generateText({
    model: client,
    prompt,
    maxOutputTokens: 2048,
  });

  await recordings.update(recordingId, { aiSummary: text.trim() });
  console.log(
    `[auto-summarize] Summary generated for recording ${recordingId}`,
  );
}
