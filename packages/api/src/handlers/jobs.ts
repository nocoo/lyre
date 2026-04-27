/**
 * Handlers for `/api/jobs/[id]` — poll an ASR job.
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

/**
 * List jobs scoped to the current user.
 *
 * If `recordingId` is provided, returns jobs for that recording (after
 * verifying ownership). Otherwise returns all currently-active jobs that
 * belong to recordings owned by the user. Used by the SPA's job-polling hook.
 */
export async function listJobsHandler(
  ctx: RuntimeContext,
  recordingId?: string | null,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { jobs, recordings } = makeRepos(ctx.db);
  if (recordingId) {
    const recording = await recordings.findById(recordingId);
    if (!recording || recording.userId !== ctx.user.id) {
      return json({ items: [] });
    }
    const items = await jobs.findByRecordingId(recordingId);
    return json({ items });
  }
  const active = await jobs.findActive();
  const ownedItems = [];
  for (const job of active) {
    const rec = await recordings.findById(job.recordingId);
    if (rec && rec.userId === ctx.user.id) {
      ownedItems.push(job);
    }
  }
  return json({ items: ownedItems });
}

export async function getJobHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { jobs, recordings } = makeRepos(ctx.db);
  const job = await jobs.findById(id);
  if (!job) return notFound("Job not found");

  const recording = await recordings.findById(job.recordingId);
  if (!recording || recording.userId !== ctx.user.id) {
    return notFound("Job not found");
  }

  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return json(job);
  }

  try {
    const provider = getAsrProvider(ctx.env);
    const result = await pollJob(job, provider, ctx.env, ctx.db);
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
 * Wired into the worker's `scheduled()` export so Cloudflare Cron Triggers
 * drive ASR polling.
 */
export async function cronTickHandler(
  ctx: RuntimeContext,
): Promise<CronTickResult> {
  const provider = getAsrProvider(ctx.env);
  const { jobs } = makeRepos(ctx.db);
  const active = await jobs.findActive();
  const result: CronTickResult = {
    scanned: active.length,
    changed: 0,
    failed: 0,
    errors: [],
  };

  for (const job of active) {
    try {
      const out = await pollJob(job, provider, ctx.env, ctx.db);
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
