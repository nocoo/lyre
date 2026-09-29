/**
 * Recording, folder, tag, transcription, and pagination contracts.
 *
 * Client-safe contracts and validation, no runtime imports.
 * Cross-boundary shape between the API package and any UI consumer.
 */

export const RECORDING_STATUSES = ["uploaded", "transcribing", "completed", "failed"] as const;

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
	/**
	 * Lifecycle of the AI summary generation.
	 * `null` = never attempted (default for fresh recordings and pre-migration rows).
	 * `running` = auto or manual generation in flight.
	 * `succeeded` = `aiSummary` is populated with the final text.
	 * `failed` = generation errored; see `aiSummaryError`. `aiSummary` is null.
	 */
	aiSummaryStatus: "running" | "succeeded" | "failed" | null;
	/** Human-readable error message when `aiSummaryStatus === "failed"`. */
	aiSummaryError: string | null;
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

export const MAX_LOCAL_TRANSCRIPTION_BYTES = 5 * 1024 * 1024;

export interface LocalTranscription {
	result: { language: string };
	transcription: Array<{ offsets: { from: number; to: number }; text: string }>;
	model?: { type?: string };
}

export interface ParsedLocalTranscription {
	fullText: string;
	sentences: TranscriptionSentence[];
	language: string;
	model: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLocalTranscription(
	value: unknown,
	duration?: number | null,
): ParsedLocalTranscription {
	if (
		!isObject(value) ||
		new TextEncoder().encode(JSON.stringify(value)).length > MAX_LOCAL_TRANSCRIPTION_BYTES
	) {
		throw new Error("Local transcription must be a JSON object of at most 5 MiB");
	}
	if (
		!isObject(value.result) ||
		typeof value.result.language !== "string" ||
		!value.result.language.trim() ||
		value.result.language.length > 32
	) {
		throw new Error("Local transcription requires result.language");
	}
	if (!Array.isArray(value.transcription) || value.transcription.length > 50_000) {
		throw new Error("Local transcription requires at most 50000 segments");
	}
	if (duration != null && (!Number.isFinite(duration) || duration < 0)) {
		throw new Error("Recording duration must be a finite non-negative number");
	}
	let model = "unknown";
	if (value.model !== undefined) {
		if (
			!isObject(value.model) ||
			(value.model.type !== undefined &&
				(typeof value.model.type !== "string" || !/^[\w. -]{1,128}$/.test(value.model.type)))
		) {
			throw new Error("Invalid local transcription model");
		}
		if (typeof value.model.type === "string") model = value.model.type;
	}
	const language = value.result.language.trim();
	const sentences: TranscriptionSentence[] = [];
	let previousBegin = 0;
	let previousEnd = 0;
	for (const segment of value.transcription) {
		if (
			!isObject(segment) ||
			!isObject(segment.offsets) ||
			typeof segment.text !== "string" ||
			segment.text.length > 100_000
		) {
			throw new Error("Invalid local transcription segment");
		}
		const begin = segment.offsets.from;
		const end = segment.offsets.to;
		if (
			typeof begin !== "number" ||
			typeof end !== "number" ||
			!Number.isSafeInteger(begin) ||
			!Number.isSafeInteger(end) ||
			begin < previousBegin ||
			end < previousEnd ||
			end < begin ||
			(duration != null && end > duration * 1000 + 1000)
		) {
			throw new Error(
				"Local transcription timestamps must be monotonic milliseconds within the recording",
			);
		}
		previousBegin = begin;
		previousEnd = end;
		const text = segment.text.trim();
		if (!text) continue;
		sentences.push({
			sentenceId: sentences.length,
			channelId: 0,
			beginTime: begin,
			endTime: end,
			text,
			language,
			emotion: "",
		});
	}
	return {
		fullText: sentences.map((sentence) => sentence.text).join("\n"),
		sentences,
		language,
		model,
	};
}
