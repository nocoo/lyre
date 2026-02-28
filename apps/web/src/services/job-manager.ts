/**
 * Job Manager — server-side singleton that polls active transcription jobs.
 *
 * Runs independently of any page lifecycle. When a job's status changes,
 * it emits events via a listener callback. This decouples the polling engine
 * from the notification transport (SSE, WebSocket, etc.).
 *
 * Design:
 * - Tracks active (PENDING/RUNNING) jobs in an in-memory Map
 * - Polls all active jobs every POLL_INTERVAL_MS via the ASR provider
 * - On status change, calls registered listeners with the event
 * - On terminal state (SUCCEEDED/FAILED), removes from active set
 * - Recovers active jobs from DB on first start (lazy init)
 * - Safe for singleton use in Next.js standalone mode (long-lived process)
 *
 * Testability:
 * - Constructor accepts dependencies (provider factory, repos, interval)
 * - No module-level side effects — must be explicitly started
 */

import type { AsrProvider } from "@/services/asr";
import type { DbTranscriptionJob } from "@/db/schema";
import type { JobStatus } from "@/lib/types";
import { pollJob } from "@/services/job-processor";

// ── Types ──

export interface JobEvent {
  jobId: string;
  recordingId: string;
  status: JobStatus;
  previousStatus: JobStatus;
}

export type JobEventListener = (event: JobEvent) => void;

export interface JobManagerDeps {
  /** Returns an AsrProvider (called once per poll cycle, not per job). */
  getProvider: () => AsrProvider;
  /** Finds all non-terminal jobs in the database. */
  findActiveJobs: () => DbTranscriptionJob[];
  /** Finds a single job by ID. */
  findJobById: (id: string) => DbTranscriptionJob | undefined;
  /** Poll interval in milliseconds (default: 5000). */
  pollIntervalMs?: number;
}

// ── Implementation ──

export class JobManager {
  private activeJobs = new Map<string, DbTranscriptionJob>();
  private listeners = new Set<JobEventListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private initialized = false;
  private stopped = false;
  private readonly deps: Required<JobManagerDeps>;

  constructor(deps: JobManagerDeps) {
    this.deps = {
      pollIntervalMs: 5000,
      ...deps,
    };
  }

  /** Register a listener for job status change events. Returns unsubscribe fn. */
  onJobEvent(listener: JobEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Add a job to the active tracking set and ensure polling is running. */
  track(job: DbTranscriptionJob): void {
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return;
    this.activeJobs.set(job.id, job);
    this.ensurePolling();
  }

  /** Get the number of currently tracked active jobs. */
  get activeCount(): number {
    return this.activeJobs.size;
  }

  /** Check if a specific job is being tracked. */
  isTracking(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /**
   * Start the manager. Recovers active jobs from DB and begins polling.
   * Safe to call multiple times (idempotent).
   */
  start(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.stopped = false;
    this.recover();
  }

  /** Stop polling and clear all state. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeJobs.clear();
    this.listeners.clear();
    this.initialized = false;
    this.polling = false;
  }

  // ── Internal ──

  private recover(): void {
    const jobs = this.deps.findActiveJobs();
    for (const job of jobs) {
      this.activeJobs.set(job.id, job);
    }
    if (this.activeJobs.size > 0) {
      this.ensurePolling();
    }
  }

  private ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollAll(), this.deps.pollIntervalMs);
    // Also do an immediate first poll
    void this.pollAll();
  }

  private async pollAll(): Promise<void> {
    // Guard against concurrent poll cycles and stopped state
    if (this.polling || this.stopped) return;
    this.polling = true;

    try {
      const provider = this.deps.getProvider();
      const jobIds = [...this.activeJobs.keys()];

      for (const jobId of jobIds) {
        // Bail if stopped mid-cycle
        if (this.stopped) break;

        // Re-read from DB to get latest state (another poll cycle may have updated it)
        const freshJob = this.deps.findJobById(jobId);
        if (!freshJob) {
          this.activeJobs.delete(jobId);
          continue;
        }

        // Skip if already terminal (race with manual API poll)
        if (freshJob.status === "SUCCEEDED" || freshJob.status === "FAILED") {
          this.activeJobs.delete(jobId);
          continue;
        }

        try {
          const result = await pollJob(freshJob, provider);

          if (result.changed && result.previousStatus) {
            const event: JobEvent = {
              jobId: result.job.id,
              recordingId: result.job.recordingId,
              status: result.job.status,
              previousStatus: result.previousStatus,
            };
            this.emit(event);
          }

          // Remove from tracking if terminal; skip update if stopped mid-cycle
          if (this.stopped) break;
          if (result.job.status === "SUCCEEDED" || result.job.status === "FAILED") {
            this.activeJobs.delete(jobId);
          } else {
            // Update cached job with latest data
            this.activeJobs.set(jobId, result.job);
          }
        } catch (err) {
          // Log but don't remove — retry on next cycle
          console.warn(`[job-manager] Failed to poll job ${jobId}:`, err);
        }
      }

      // Stop timer if no more active jobs
      if (this.activeJobs.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    } finally {
      this.polling = false;
    }
  }

  private emit(event: JobEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn("[job-manager] Listener error:", err);
      }
    }
  }
}
