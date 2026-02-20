/**
 * Recording Detail View Model
 *
 * Pure functions that transform a RecordingDetail into view-ready shapes.
 * Covers: metadata display, transcription formatting, job status tracking.
 */

import type {
  RecordingDetail,
  TranscriptionSentence,
  TranscriptionJob,
} from "./types";
import {
  formatFileSize,
  formatDuration,
  formatDate,
  getStatusInfo,
  type StatusInfo,
} from "./recordings-list-vm";

// ── Metadata VM ──

export interface RecordingMetadataVM {
  id: string;
  title: string;
  description: string;
  fileName: string;
  fileSize: string;
  duration: string;
  format: string;
  sampleRate: string;
  status: StatusInfo;
  tags: string[];
  createdAt: string;
  canTranscribe: boolean;
  canRetranscribe: boolean;
}

export function toRecordingMetadataVM(
  detail: RecordingDetail,
): RecordingMetadataVM {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description ?? "",
    fileName: detail.fileName,
    fileSize: formatFileSize(detail.fileSize),
    duration: formatDuration(detail.duration),
    format: detail.format ?? "unknown",
    sampleRate: detail.sampleRate ? `${detail.sampleRate} Hz` : "—",
    status: getStatusInfo(detail.status),
    tags: detail.tags,
    createdAt: formatDate(detail.createdAt),
    canTranscribe: detail.status === "uploaded",
    canRetranscribe: detail.status === "completed" || detail.status === "failed",
  };
}

// ── Transcription VM ──

export interface SentenceVM {
  id: number;
  text: string;
  startTime: string; // formatted MM:SS.ms
  endTime: string;
  duration: string;
  beginTimeMs: number; // raw milliseconds for seeking
  endTimeMs: number; // raw milliseconds for active detection
  language: string;
  emotion: string;
}

/** Format milliseconds to MM:SS.m (e.g. "1:23.4") */
export function formatTimestamp(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function toSentenceVM(sentence: TranscriptionSentence): SentenceVM {
  const durationMs = sentence.endTime - sentence.beginTime;
  return {
    id: sentence.sentenceId,
    text: sentence.text,
    startTime: formatTimestamp(sentence.beginTime),
    endTime: formatTimestamp(sentence.endTime),
    duration: `${(durationMs / 1000).toFixed(1)}s`,
    beginTimeMs: sentence.beginTime,
    endTimeMs: sentence.endTime,
    language: sentence.language,
    emotion: sentence.emotion,
  };
}

export interface TranscriptionVM {
  fullText: string;
  sentences: SentenceVM[];
  sentenceCount: number;
  language: string;
  wordCount: number;
}

export function toTranscriptionVM(
  detail: RecordingDetail,
): TranscriptionVM | null {
  if (!detail.transcription) return null;

  const { fullText, sentences, language } = detail.transcription;
  return {
    fullText,
    sentences: sentences.map(toSentenceVM),
    sentenceCount: sentences.length,
    language: language ?? "unknown",
    wordCount: countWords(fullText),
  };
}

/** Count words in text (handles mixed CJK + Latin) */
export function countWords(text: string): number {
  if (!text.trim()) return 0;

  // Split on whitespace, filter empties
  const tokens = text.trim().split(/\s+/);
  return tokens.length;
}

/**
 * Find the index of the active sentence based on current playback time.
 * Returns -1 if no sentence matches the current time.
 *
 * @param sentences - Sentence VMs with raw millisecond times
 * @param currentTimeSeconds - Current audio playback time in seconds
 */
export function findActiveSentenceIndex(
  sentences: SentenceVM[],
  currentTimeSeconds: number,
): number {
  const currentMs = currentTimeSeconds * 1000;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    if (currentMs >= s.beginTimeMs && currentMs < s.endTimeMs) {
      return i;
    }
  }
  return -1;
}

// ── Job Status VM ──

export interface JobStatusVM {
  status: string;
  isRunning: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  submitTime: string;
  endTime: string;
  processingDuration: string;
  usageSeconds: string;
  errorMessage: string;
}

export function toJobStatusVM(job: TranscriptionJob | null): JobStatusVM | null {
  if (!job) return null;

  return {
    status: job.status,
    isRunning: job.status === "PENDING" || job.status === "RUNNING",
    isCompleted: job.status === "SUCCEEDED",
    isFailed: job.status === "FAILED",
    submitTime: job.submitTime ?? "—",
    endTime: job.endTime ?? "—",
    processingDuration: computeProcessingDuration(
      job.submitTime,
      job.endTime,
    ),
    usageSeconds: job.usageSeconds
      ? formatDuration(job.usageSeconds)
      : "—",
    errorMessage: job.errorMessage ?? "",
  };
}

/** Compute duration between submit and end time strings */
export function computeProcessingDuration(
  submitTime: string | null,
  endTime: string | null,
): string {
  if (!submitTime || !endTime) return "—";
  const start = new Date(submitTime).getTime();
  const end = new Date(endTime).getTime();
  if (isNaN(start) || isNaN(end)) return "—";
  const diffSeconds = Math.max(0, (end - start) / 1000);
  return formatDuration(diffSeconds);
}

// ── Combined detail VM ──

export interface RecordingDetailVM {
  metadata: RecordingMetadataVM;
  transcription: TranscriptionVM | null;
  job: JobStatusVM | null;
  hasTranscription: boolean;
  isTranscribing: boolean;
}

export function toRecordingDetailVM(
  detail: RecordingDetail,
): RecordingDetailVM {
  const job = toJobStatusVM(detail.latestJob);
  return {
    metadata: toRecordingMetadataVM(detail),
    transcription: toTranscriptionVM(detail),
    job,
    hasTranscription: detail.transcription !== null,
    isTranscribing: job?.isRunning ?? false,
  };
}
