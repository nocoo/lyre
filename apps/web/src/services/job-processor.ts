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
} from "@/db/repositories";
import type { AsrProvider } from "@/services/asr";
import { parseTranscriptionResult } from "@/services/asr";
import { presignPut, makeResultKey } from "@/services/oss";
import {
  resolveAiConfig,
  createAiClient,
  buildSummaryPrompt,
  type AiProvider,
  type SdkType,
} from "@/services/ai";
import { generateText } from "ai";
import type { DbTranscriptionJob } from "@/db/schema";
import type { JobStatus } from "@/lib/types";

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
): Promise<JobPollResult> {
  // Already terminal — nothing to do
  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return { job, previousStatus: null, changed: false };
  }

  const previousStatus = job.status;
  const pollResult = await provider.poll(job.taskId);
  const newStatus = pollResult.output.task_status;

  // Build update payload
  const updateData: Parameters<typeof jobsRepo.update>[1] = {
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
      transcriptionsRepo.deleteByRecordingId(job.recordingId);

      // Save transcription
      transcriptionsRepo.create({
        id: crypto.randomUUID(),
        recordingId: job.recordingId,
        jobId: job.id,
        fullText: parsed.fullText,
        sentences: parsed.sentences,
        language: parsed.language,
      });

      // Archive raw result to OSS (best-effort)
      archiveRawResult(job.id, rawResult).catch((err) => {
        console.warn("Failed to archive raw ASR result to OSS:", err);
      });

      // Update recording status
      recordingsRepo.update(job.recordingId, { status: "completed" });

      // Auto-summarize if enabled (best-effort)
      const recording = recordingsRepo.findById(job.recordingId);
      if (recording) {
        autoSummarize(recording.userId, job.recordingId, parsed.fullText).catch(
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
      recordingsRepo.update(job.recordingId, { status: "failed" });
    }
  }

  // Handle FAILED
  if (newStatus === "FAILED") {
    updateData.errorMessage =
      pollResult.output.message ?? "Transcription failed";
    recordingsRepo.update(job.recordingId, { status: "failed" });
  }

  const updatedJob = jobsRepo.update(job.id, updateData);
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
): Promise<void> {
  if (process.env.SKIP_OSS_ARCHIVE === "1") return;

  const key = makeResultKey(jobId, "transcription.json");
  const body = JSON.stringify(rawResult);
  const contentType = "application/json";

  const uploadUrl = presignPut(key, contentType, 900);

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
): Promise<void> {
  const all = settingsRepo.findByUserId(userId);
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
    baseURL: baseURL || undefined,
    sdkType: (sdkType || undefined) as SdkType | undefined,
  });

  const client = createAiClient(config);
  const prompt = buildSummaryPrompt(fullText);

  const { text } = await generateText({
    model: client(config.model),
    prompt,
    maxOutputTokens: 2048,
  });

  recordingsRepo.update(recordingId, { aiSummary: text.trim() });
  console.log(
    `[auto-summarize] Summary generated for recording ${recordingId}`,
  );
}
