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
	JOB_STATUSES,
	type JobStatus,
	type TranscriptionJob,
} from "../contracts/jobs";
export {
	type Folder,
	type PaginatedResponse,
	RECORDING_STATUSES,
	type Recording,
	type RecordingDetail,
	type RecordingListItem,
	type RecordingStatus,
	SENTENCE_ID_CHANNEL_STRIDE,
	type Setting,
	type Tag,
	type Transcription,
	type TranscriptionSentence,
	type User,
} from "../contracts/recordings";
