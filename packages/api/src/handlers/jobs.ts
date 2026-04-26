/**
 * Handlers for `/api/jobs/[id]` — poll an ASR job.
 *
 * Note: the SSE route `/api/jobs/events` is intentionally NOT extracted
 * (decision 8 — kept on legacy until Wave E).
 */

import { makeRepos } from "../db/repositories";
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
  const { jobs, recordings } = makeRepos(ctx.db);
  const job = jobs.findById(id);
  if (!job) return notFound("Job not found");

  const recording = recordings.findById(job.recordingId);
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

export interface CronTickResult {
  scanned: number;
  changed: number;
  failed: number;
  errors: Array<{ jobId: string; message: string }>;
}

/**
 * Cron tick: poll all active (PENDING/RUNNING) ASR jobs once.
 *
 * Replaces the legacy in-process JobManager singleton on the new worker
 * (decision 8 — A+C hybrid). Wired into the worker's `scheduled()` export
 * so Cloudflare Cron Triggers drive ASR polling. Legacy `JobManager` keeps
 * running in the Next.js process until Wave E.
 */
export async function cronTickHandler(
  ctx: RuntimeContext,
): Promise<CronTickResult> {
  const provider = getAsrProvider(ctx.env);
  const { jobs } = makeRepos(ctx.db);
  const active = jobs.findActive();
  const result: CronTickResult = {
    scanned: active.length,
    changed: 0,
    failed: 0,
    errors: [],
  };

  for (const job of active) {
    try {
      const out = await pollJob(job, provider, ctx.env);
      if (out.changed) result.changed += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        jobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
