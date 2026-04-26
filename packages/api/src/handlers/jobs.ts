/**
 * Handlers for `/api/jobs/[id]` — poll an ASR job.
 *
 * Note: the SSE route `/api/jobs/events` is intentionally NOT extracted
 * (decision 8 — kept on legacy until Wave E).
 */

import { jobsRepo, recordingsRepo } from "../db/repositories";
import { getAsrProvider } from "../services/asr-provider";
import { pollJob } from "../services/job-processor";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  notFound,
  unauthorized,
  serverError,
  type HandlerResponse,
} from "./http";

export async function getJobHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const job = jobsRepo.findById(id);
  if (!job) return notFound("Job not found");

  const recording = recordingsRepo.findById(job.recordingId);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Job not found");
  }

  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return json(job);
  }

  try {
    const provider = getAsrProvider(ctx.env);
    const result = await pollJob(job, provider, ctx.env);
    return json(result.job);
  } catch (error) {
    console.error("Failed to poll ASR job:", error);
    return serverError(
      `Failed to poll job status: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
