/**
 * Job (transcription) contracts.
 *
 * Client-safe: pure types/enums, no runtime imports.
 */

export const JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface TranscriptionJob {
  id: string;
  recordingId: string;
  taskId: string;
  requestId: string | null;
  status: JobStatus;
  submitTime: string | null;
  endTime: string | null;
  usageSeconds: number | null;
  errorMessage: string | null;
  resultUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Server → client event for job status changes.
 */
export interface JobEvent {
  jobId: string;
  recordingId: string;
  status: JobStatus;
  previousStatus: JobStatus;
}
