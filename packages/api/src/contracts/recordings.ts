/**
 * Recording, folder, tag, transcription, and pagination contracts.
 *
 * Client-safe: pure types, no runtime imports.
 * Cross-boundary shape between the API package and any UI consumer.
 */

export const RECORDING_STATUSES = [
  "uploaded",
  "transcribing",
  "completed",
  "failed",
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

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
  icon: string;
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
  duration: number | null;
  format: string | null;
  sampleRate: number | null;
  ossKey: string;
  notes: string | null;
  aiSummary: string | null;
  recordedAt: number | null;
  status: RecordingStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptionSentence {
  /**
   * Composite ID stable across all channels in this transcription:
   * `channelId * SENTENCE_ID_CHANNEL_STRIDE + sentence_id`. DashScope's
   * raw `sentence_id` restarts at 0 per channel, so we encode the
   * channel into a higher decimal band so consumers (front-end karaoke,
   * `/words` endpoint) can use a single number as the row key.
   */
  sentenceId: number;
  /** Source audio track (channel) this sentence came from. */
  channelId: number;
  beginTime: number;
  endTime: number;
  text: string;
  language: string;
  emotion: string;
}

/**
 * Multiplier used when collapsing the per-channel `(channel_id,
 * sentence_id)` tuple into the single `TranscriptionSentence.sentenceId`
 * key. Keep this in sync with `parseTranscriptionResult` and
 * `wordsHandler`.
 */
export const SENTENCE_ID_CHANNEL_STRIDE = 100_000;

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

export interface RecordingListItem extends Recording {
  folder: Folder | null;
  resolvedTags: Tag[];
}

export interface RecordingDetail extends Recording {
  transcription: Transcription | null;
  latestJob: TranscriptionJob | null;
  folder: Folder | null;
  resolvedTags: Tag[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Re-export the job contract for convenience when describing recordings.
import type { TranscriptionJob } from "./jobs";
export type { TranscriptionJob };
