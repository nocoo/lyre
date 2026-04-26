/**
 * useJobEvents — polling-based replacement for the legacy SSE hook.
 *
 * Per Wave D of the CF Worker migration, the SPA does not consume SSE.
 * This hook polls `/api/jobs/active` (or a single job, see below) on an
 * interval while `enabled` is true and fires `onEvent` whenever a job's
 * status changes since the last tick.
 *
 * To minimise blast radius vs. the legacy SSE shape, we keep the same
 * `{ onEvent, enabled }` surface. The polled endpoint is a thin GET to
 * `/api/jobs?recordingId=...` — but since the only known caller filters
 * by `recordingId`, we expose the optional `recordingId` so the hook can
 * narrow the request.
 */

import { useEffect, useRef } from "react";
import type { JobEvent } from "@lyre/api/contracts/jobs";
import { apiJson, ApiError } from "@/lib/api";

export interface UseJobEventsOptions {
  /** Called on each detected job status change. */
  onEvent: (event: JobEvent) => void;
  /** Whether to poll. Defaults to true. */
  enabled?: boolean;
  /** Restrict polling to a single recording's active jobs. */
  recordingId?: string;
  /** Poll interval in ms. Defaults to 5s. */
  intervalMs?: number;
}

interface JobsListResponse {
  items: Array<{ id: string; recordingId: string; status: string }>;
}

export function useJobEvents({
  onEvent,
  enabled = true,
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
        const path = recordingId
          ? `/api/jobs?recordingId=${encodeURIComponent(recordingId)}`
          : `/api/jobs`;
        const data = await apiJson<JobsListResponse>(path);
        if (cancelled) return;
        for (const job of data.items ?? []) {
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
      } catch (err) {
        // 401 already triggers reload via api layer; swallow other errors.
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
  }, [enabled, recordingId, intervalMs]);
}
