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
 * This module has NO HTTP/framework dependencies — it operates purely on
 * repositories and the ASR provider, making it testable in isolation.
 */

import {
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
import type { LyreEnv } from "../runtime/env";

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
export async function pollJob(
  job: DbTranscriptionJob,
  provider: AsrProvider,
  env: LyreEnv,
  db: LyreDb,
): Promise<JobPollResult> {
  const jobs = makeJobsRepo(db);
  const recordings = makeRecordingsRepo(db);
  const transcriptions = makeTranscriptionsRepo(db);
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

  // Track whether we successfully processed a SUCCEEDED result and should
  // fire auto-summarize AFTER the job has been persisted as terminal. We
  // deliberately do NOT run summarize inside the ASR try/catch below —
  // summarize failures must not roll the job/recording back to FAILED.
  let summarizeInput: { userId: string; fullText: string } | null = null;

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
      archiveRawResult(job.id, rawResult, env).catch((err) => {
        console.warn("Failed to archive raw ASR result to OSS:", err);
      });

      // Update recording status
      await recordings.update(job.recordingId, { status: "completed" });

      const recording = await recordings.findById(job.recordingId);
      if (recording) {
        summarizeInput = {
          userId: recording.userId,
          fullText: parsed.fullText,
        };
      }
    } catch (err) {
      console.error("Failed to process transcription result:", err);
      updateData.status = "FAILED";
      updateData.errorMessage =
        err instanceof Error
          ? `Result processing failed: ${err.message}`
          : "Result processing failed";
      await recordings.update(job.recordingId, { status: "failed" });
      summarizeInput = null;
    }
  }

  // Handle FAILED
  if (newStatus === "FAILED") {
    updateData.errorMessage =
      pollResult.output.message ?? "Transcription failed";
    await recordings.update(job.recordingId, { status: "failed" });
  }

  // Persist the terminal job state BEFORE running auto-summarize. This
  // closes a race where the next cron tick (fires every minute) would
  // still see PENDING/RUNNING during the up-to-60s summary window, re-poll
  // the same job, and re-run transcription persistence + summary.
  const updatedJob = await jobs.update(job.id, updateData);
  const finalJob = updatedJob ?? job;

  // Auto-summarize AFTER the job is terminal, on its own path. Awaited so
  // the surrounding `waitUntil` keeps the isolate alive; guarded internally
  // so nothing thrown here can escape and mislead the caller into thinking
  // the ASR step failed.
  if (summarizeInput) {
    await autoSummarize(
      summarizeInput.userId,
      job.recordingId,
      summarizeInput.fullText,
      db,
    );
  }

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
 *
 * This function is FULLY GUARDED — no error escapes the top-level try.
 * Instead every failure is persisted to `recordings.aiSummaryStatus`
 * and `aiSummaryError` so the UI can surface it. The caller is
 * expected to `await` this so the surrounding `ctx.waitUntil` on the
 * Cloudflare scheduled handler keeps the isolate alive until the AI
 * call finishes.
 *
 * The `generate` parameter defaults to Vercel AI SDK's `generateText`
 * but is injectable so tests can drive it without a live LLM.
 */
export async function autoSummarize(
  userId: string,
  recordingId: string,
  fullText: string,
  db: LyreDb,
  generate: typeof generateText = generateText,
): Promise<void> {
  const settings = makeSettingsRepo(db);
  const recordings = makeRecordingsRepo(db);
  const all = await settings.findByUserId(userId);
  const map = new Map<string, string>(
    all.map((s: { key: string; value: string }) => [s.key, s.value]),
  );

  // Preflight gates: never touch aiSummaryStatus if auto-summarize is
  // simply not applicable — leaving status=null preserves the "never
  // attempted" signal so the UI shows a plain Generate button.
  if (map.get("ai.autoSummarize") !== "true") return;

  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";
  const baseURL = map.get("ai.baseURL") ?? "";
  const sdkType = map.get("ai.sdkType") ?? "";
  const rawAuth = map.get("ai.authType") ?? "";
  const authType =
    rawAuth === "bearer" || rawAuth === "apiKey" ? rawAuth : undefined;

  if (!provider || !apiKey) return;
  if (!fullText.trim()) return;

  // From here on the run is committed: mark it running, clear any prior
  // error, and drop the previous summary so the UI shows a fresh state.
  await recordings.update(recordingId, {
    aiSummaryStatus: "running",
    aiSummaryError: null,
    aiSummary: null,
  });

  try {
    const config = resolveAiConfig({
      provider: provider as AiProvider,
      apiKey,
      model,
      ...(baseURL ? { baseURL } : {}),
      ...(sdkType ? { sdkType: sdkType as SdkType } : {}),
      ...(authType ? { authType } : {}),
    });

    const client = createAiModel(config);
    const prompt = buildSummaryPrompt(fullText);

    // Hard timeout so this await can never wedge the cron tick. 60s
    // is generous — a real generation usually finishes in <10s.
    const { text } = await generate({
      model: client,
      prompt,
      maxOutputTokens: 2048,
      abortSignal: AbortSignal.timeout(60_000),
    });

    const summary = text.trim();
    if (!summary) {
      throw new Error("AI returned an empty response");
    }

    await recordings.update(recordingId, {
      aiSummary: summary,
      aiSummaryStatus: "succeeded",
      aiSummaryError: null,
    });
    console.log(
      `[auto-summarize] Summary generated for recording ${recordingId}`,
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "TimeoutError" || err.name === "AbortError"
          ? "AI request timed out after 60s"
          : err.message
        : String(err);
    console.warn(
      `[auto-summarize] Failed for recording ${recordingId}: ${message}`,
    );
    await recordings.update(recordingId, {
      aiSummaryStatus: "failed",
      aiSummaryError: message,
      aiSummary: null,
    });
  }
}
