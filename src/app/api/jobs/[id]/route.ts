/**
 * GET /api/jobs/[id]
 *
 * Polls a transcription job status.
 *
 * When status is still PENDING/RUNNING:
 *   - Polls the ASR provider for latest status
 *   - Updates the job record
 *   - Returns current status
 *
 * When status transitions to SUCCEEDED:
 *   - Fetches the full transcription result
 *   - Parses sentence-level data
 *   - Saves transcription to database
 *   - Archives raw result JSON to OSS
 *   - Updates recording status to "completed"
 *
 * When status transitions to FAILED:
 *   - Updates the job with error message
 *   - Updates recording status to "failed"
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import {
  jobsRepo,
  recordingsRepo,
  transcriptionsRepo,
  settingsRepo,
} from "@/db/repositories";
import { getAsrProvider } from "@/services/asr-provider";
import { parseTranscriptionResult } from "@/services/asr";
import { presignPut, makeResultKey } from "@/services/oss";
import {
  resolveAiConfig,
  createAiClient,
  buildSummaryPrompt,
  type AiProvider,
} from "@/services/ai";
import { generateText } from "ai";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const job = jobsRepo.findById(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Verify the job belongs to the user's recording
  const recording = recordingsRepo.findById(job.recordingId);
  if (!recording || recording.userId !== user.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // If job is already in a terminal state, return it directly
  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return NextResponse.json(job);
  }

  // Poll the ASR provider for latest status
  try {
    const provider = getAsrProvider();
    const pollResult = await provider.poll(job.taskId);
    const newStatus = pollResult.output.task_status;

    // Update job with latest status
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
        // Fetch and parse the transcription result
        const rawResult = await provider.fetchResult(
          pollResult.output.result.transcription_url,
        );
        const parsed = parseTranscriptionResult(rawResult);

        // Remove existing transcription if re-transcribing (unique constraint on recordingId)
        transcriptionsRepo.deleteByRecordingId(job.recordingId);

        // Save transcription to database
        transcriptionsRepo.create({
          id: crypto.randomUUID(),
          recordingId: job.recordingId,
          jobId: id,
          fullText: parsed.fullText,
          sentences: parsed.sentences,
          language: parsed.language,
        });

        // Archive raw result to OSS (best-effort)
        archiveRawResult(id, rawResult).catch((err) => {
          console.warn("Failed to archive raw ASR result to OSS:", err);
        });

        // Update recording status to "completed"
        recordingsRepo.update(job.recordingId, { status: "completed" });

        // Auto-summarize if enabled (best-effort, non-blocking)
        autoSummarize(recording.userId, job.recordingId, parsed.fullText).catch(
          (err) => {
            console.warn("[auto-summarize] Failed:", err);
          },
        );
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

    const updatedJob = jobsRepo.update(id, updateData);
    return NextResponse.json(updatedJob ?? job);
  } catch (error) {
    console.error("Failed to poll ASR job:", error);
    return NextResponse.json(
      {
        error: "Failed to poll job status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * Archive the raw ASR result JSON to OSS.
 * Uploads via presigned PUT URL.
 */
async function archiveRawResult(
  jobId: string,
  rawResult: unknown,
): Promise<void> {
  const key = makeResultKey(jobId, "transcription.json");
  const body = JSON.stringify(rawResult);
  const contentType = "application/json";

  // Generate presigned PUT URL (15 minute expiry is plenty for immediate upload)
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
 * Only runs if the user has ai.autoSummarize enabled and AI is configured.
 */
async function autoSummarize(
  userId: string,
  recordingId: string,
  fullText: string,
): Promise<void> {
  // Check if auto-summarize is enabled
  const all = settingsRepo.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));

  if (map.get("ai.autoSummarize") !== "true") return;

  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";

  if (!provider || !apiKey) return;

  const config = resolveAiConfig({
    provider: provider as AiProvider,
    apiKey,
    model,
  });

  const client = createAiClient(config);
  const prompt = buildSummaryPrompt(fullText);

  const { text } = await generateText({
    model: client(config.model),
    prompt,
    maxOutputTokens: 2048,
  });

  recordingsRepo.update(recordingId, { aiSummary: text.trim() });
  console.log(`[auto-summarize] Summary generated for recording ${recordingId}`);
}
