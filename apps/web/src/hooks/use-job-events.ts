/**
 * useJobEvents — polling-based replacement for the legacy SSE hook.
 *
 * Per Wave D of the CF Worker migration (decision 8), the SPA does not
 * consume SSE. This hook polls on an interval while `enabled` is true and
 * fires `onEvent` whenever a job's status changes since the last tick.
 *
 * Three modes (mutually exclusive — pass at most one):
 * - `jobId`        → poll `GET /api/jobs/:id` (preferred when known)
 * - `recordingId`  → poll `GET /api/jobs?recordingId=...`
 * - neither        → poll `GET /api/jobs` (all of the user's active jobs)
 */

import { useEffect, useRef } from "react";
import type { JobEvent } from "@lyre/api/contracts/jobs";
import { apiJson, ApiError } from "@/lib/api";

export interface UseJobEventsOptions {
  /** Called on each detected job status change. */
  onEvent: (event: JobEvent) => void;
  /** Whether to poll. Defaults to true. */
  enabled?: boolean;
  /** Poll a single known job. Highest precedence. */
  jobId?: string | null;
  /** Restrict polling to a single recording's jobs. */
  recordingId?: string;
  /** Poll interval in ms. Defaults to 5s. */
  intervalMs?: number;
}

interface JobItem {
  id: string;
  recordingId: string;
  status: string;
}

interface JobsListResponse {
  items: JobItem[];
}

export function useJobEvents({
  onEvent,
  enabled = true,
  jobId,
  recordingId,
  intervalMs = 5000,
}: UseJobEventsOptions) {
  const callbackRef = useRef(onEvent);

  useEffect(() => {
    callbackRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    const seen = new Map<string, string>();
    let cancelled = false;

    const tick = async () => {
      try {
        let items: JobItem[];
        let isListMode = false;
        if (jobId) {
          const job = await apiJson<JobItem>(
            `/api/jobs/${encodeURIComponent(jobId)}`,
          );
          items = [job];
        } else {
          isListMode = !recordingId;
          const path = recordingId
            ? `/api/jobs?recordingId=${encodeURIComponent(recordingId)}`
            : `/api/jobs`;
          const data = await apiJson<JobsListResponse>(path);
          items = data.items ?? [];
        }
        if (cancelled) return;
        const currentIds = new Set<string>();
        for (const job of items) {
          currentIds.add(job.id);
          const prev = seen.get(job.id);
          if (prev !== job.status) {
            seen.set(job.id, job.status);
            callbackRef.current({
              jobId: job.id,
              recordingId: job.recordingId,
              status: job.status,
            } as JobEvent);
          }
        }
        // List mode (`GET /api/jobs`) only returns PENDING/RUNNING. When a
        // previously-seen job disappears, the cron tick has flipped it to a
        // terminal status — fetch the job once to discover SUCCEEDED vs
        // FAILED, then emit the missed terminal event.
        if (isListMode) {
          for (const [id, prevStatus] of seen) {
            if (currentIds.has(id)) continue;
            if (prevStatus === "SUCCEEDED" || prevStatus === "FAILED") {
              seen.delete(id);
              continue;
            }
            try {
              const job = await apiJson<JobItem>(
                `/api/jobs/${encodeURIComponent(id)}`,
              );
              if (cancelled) return;
              seen.set(job.id, job.status);
              callbackRef.current({
                jobId: job.id,
                recordingId: job.recordingId,
                status: job.status,
              } as JobEvent);
            } catch {
              seen.delete(id);
            }
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
      }
    };

    void tick();
    const handle = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled, jobId, recordingId, intervalMs]);
}
