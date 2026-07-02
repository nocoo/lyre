/**
 * Domain types for Lyre.
 *
 * All names here are re-exports of the single-source-of-truth contracts
 * under `../contracts/`. Kept as a stable entry point so existing
 * `@lyre/api/lib/types` imports (SPA view-models, mock data, worker
 * handlers) continue to resolve without churn. New code should import
 * directly from `@lyre/api/contracts/*` when a narrower surface fits.
 */

export {
  RECORDING_STATUSES,
  type RecordingStatus,
  type User,
  type Tag,
  type Folder,
  type Recording,
  type RecordingListItem,
  type RecordingDetail,
  type Transcription,
  type TranscriptionSentence,
  type Setting,
  type PaginatedResponse,
  SENTENCE_ID_CHANNEL_STRIDE,
} from "../contracts/recordings";

export {
  JOB_STATUSES,
  type JobStatus,
  type TranscriptionJob,
} from "../contracts/jobs";
