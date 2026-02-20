/**
 * Domain types for Lyre.
 * These mirror the database schema and API response shapes.
 */

// ── Recording status ──

export const RECORDING_STATUSES = [
  "uploaded",
  "transcribing",
  "completed",
  "failed",
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

// ── Job status ──

export const JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// ── Core domain models ──

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

export interface Folder {
  id: string;
  userId: string;
  name: string;
  icon: string; // lucide icon name
  createdAt: number;
  updatedAt: number;
}

export interface Recording {
  id: string;
  userId: string;
  folderId: string | null;
  title: string;
  description: string | null;
  fileName: string;
  fileSize: number | null;
  duration: number | null; // seconds
  format: string | null;
  sampleRate: number | null;
  ossKey: string;
  tags: string[]; // legacy JSON tags (for backward compat)
  notes: string | null;
  aiSummary: string | null;
  recordedAt: number | null; // Unix ms
  status: RecordingStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptionJob {
  id: string;
  recordingId: string;
  taskId: string; // DashScope task ID
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

export interface TranscriptionSentence {
  sentenceId: number;
  beginTime: number; // milliseconds
  endTime: number; // milliseconds
  text: string;
  language: string;
  emotion: string;
}

export interface Transcription {
  id: string;
  recordingId: string;
  jobId: string;
  fullText: string;
  sentences: TranscriptionSentence[];
  language: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  userId: string;
  key: string;
  value: string;
  updatedAt: number;
}

// ── API response shapes ──

/** Recording with optional transcription (for detail view) */
export interface RecordingDetail extends Recording {
  transcription: Transcription | null;
  latestJob: TranscriptionJob | null;
  folder: Folder | null;
  resolvedTags: Tag[];
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
