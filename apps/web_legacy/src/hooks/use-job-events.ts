/**
 * useJobEvents — React hook for consuming SSE job status updates.
 *
 * Connects to `/api/jobs/events` via EventSource. When the server pushes
 * a `job-update` event, calls the provided callback with the parsed event.
 *
 * Features:
 * - Auto-connects on mount, disconnects on unmount
 * - EventSource handles reconnection automatically
 * - Stable callback ref (no reconnect on callback change)
 * - Optional `enabled` flag to defer connection
 *
 * Usage:
 *   useJobEvents((event) => {
 *     if (event.recordingId === myRecordingId) {
 *       refetch();
 *     }
 *   });
 */

"use client";

import { useEffect, useRef } from "react";
import type { JobEvent } from "@/services/job-manager";

export interface UseJobEventsOptions {
  /** Called on each job status change event. */
  onEvent: (event: JobEvent) => void;
  /** Whether to connect. Defaults to true. */
  enabled?: boolean;
}

export function useJobEvents({ onEvent, enabled = true }: UseJobEventsOptions) {
  // Use ref for callback to avoid reconnecting when callback identity changes
  const callbackRef = useRef(onEvent);

  useEffect(() => {
    callbackRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource("/api/jobs/events");

    const handler = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as JobEvent;
        callbackRef.current(event);
      } catch {
        console.warn("[useJobEvents] Failed to parse event:", e.data);
      }
    };

    eventSource.addEventListener("job-update", handler);

    return () => {
      eventSource.removeEventListener("job-update", handler);
      eventSource.close();
    };
  }, [enabled]);
}
