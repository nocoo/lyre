/**
 * Job processor service.
 *
 * Extracts the job polling and completion logic from the API route
 * into a reusable, testable service. This is the core engine that:
 *
 * 1. Polls a single job against the ASR provider
 * 2. On SUCCEEDED: fetches result, saves transcription, archives, auto-summarizes
 * 3. On FAILED: records error and updates recording status
 * 4. Returns the updated job and its new status
 *
 * This module has NO HTTP/framework dependencies — it operates purely on
 * repositories and the ASR provider, making it testable in isolation.
 */

import { generateText } from "ai";
import {
	makeJobsRepo,
	makeRecordingsRepo,
	makeSettingsRepo,
	makeTranscriptionsRepo,
} from "../db/repositories";
import type { DbTranscriptionJob } from "../db/schema";
import type { LyreDb } from "../db/types";
import type { JobStatus } from "../lib/types";
import type { LyreEnv } from "../runtime/env";
import {
	type AiProvider,
	buildSummaryPrompt,
	createAiModel,
	resolveAiConfig,
	type SdkType,
} from "./ai";
import type { AsrProvider } from "./asr";
import { parseTranscriptionResult } from "./asr";
import { makeResultKey, presignPut } from "./oss";

// ── Types ──

export interface JobPollResult {
	job: DbTranscriptionJob;
	/** The status BEFORE this poll (null if job was already terminal). */
	previousStatus: JobStatus | null;
	/** Whether the status changed during this poll. */
	changed: boolean;
}

/**
 * How the caller wants pollJob to schedule the auto-summary follow-up.
 *
 * - `await` (default) — resolve the returned promise only after
 *   autoSummarize finishes. Used by the cron tick so its surrounding
 *   `ctx.waitUntil` keeps the isolate alive for the whole chain.
 * - `background` — pollJob returns the terminal job immediately and
 *   hands the summary promise to the caller's `waitUntil`. Used by HTTP
 *   handlers so `GET /api/jobs/:id` never blocks on a 60s AI call.
 */
export type SummarizeScheduling =
	| { mode: "await" }
	| { mode: "background"; waitUntil: (promise: Promise<unknown>) => void };

// ── Core poll function ──

/**
 * Poll a single job: check ASR provider for updates, process results on
 * terminal states, and persist all changes to the database.
 *
 * Returns the updated job and whether its status changed.
 * Throws on unrecoverable ASR provider errors (caller should handle).
 */
export async function pollJob(
	job: DbTranscriptionJob,
	provider: AsrProvider,
	env: LyreEnv,
	db: LyreDb,
	scheduling: SummarizeScheduling = { mode: "await" },
): Promise<JobPollResult> {
	const jobs = makeJobsRepo(db);
	const recordings = makeRecordingsRepo(db);
	const transcriptions = makeTranscriptionsRepo(db);
	// Already terminal — nothing to do
	if (job.status === "SUCCEEDED" || job.status === "FAILED") {
		return { job, previousStatus: null, changed: false };
	}

	const previousStatus = job.status;
	const pollResult = await provider.poll(job.taskId);
	const newStatus = pollResult.output.task_status;

	// Build update payload
	const updateData: Parameters<typeof jobs.update>[1] = {
		status: newStatus,
		requestId: pollResult.request_id,
	};

	if (pollResult.output.submit_time) {
		updateData.submitTime = pollResult.output.submit_time;
	}
	if (pollResult.output.end_time) {
		updateData.endTime = pollResult.output.end_time;
	}
	if (pollResult.usage?.seconds != null) {
		updateData.usageSeconds = pollResult.usage.seconds;
	}

	// Track whether we successfully processed a SUCCEEDED result and should
	// fire auto-summarize AFTER the job has been persisted as terminal. We
	// deliberately do NOT run summarize inside the ASR try/catch below —
	// summarize failures must not roll the job/recording back to FAILED.
	let summarizeInput: { userId: string; fullText: string } | null = null;

	// Handle SUCCEEDED
	if (newStatus === "SUCCEEDED" && pollResult.output.result) {
		updateData.resultUrl = pollResult.output.result.transcription_url;

		try {
			const rawResult = await provider.fetchResult(pollResult.output.result.transcription_url);
			const parsed = parseTranscriptionResult(rawResult);

			// Remove existing transcription if re-transcribing
			await transcriptions.deleteByRecordingId(job.recordingId);

			// Save transcription
			await transcriptions.create({
				id: crypto.randomUUID(),
				recordingId: job.recordingId,
				jobId: job.id,
				fullText: parsed.fullText,
				sentences: parsed.sentences,
				language: parsed.language,
			});

			// Archive raw result to OSS (best-effort)
			archiveRawResult(job.id, rawResult, env).catch((err) => {
				console.warn("Failed to archive raw ASR result to OSS:", err);
			});

			// Update recording status
			await recordings.update(job.recordingId, { status: "completed" });

			const recording = await recordings.findById(job.recordingId);
			if (recording) {
				summarizeInput = {
					userId: recording.userId,
					fullText: parsed.fullText,
				};
			}
		} catch (err) {
			console.error("Failed to process transcription result:", err);
			updateData.status = "FAILED";
			updateData.errorMessage =
				err instanceof Error
					? `Result processing failed: ${err.message}`
					: "Result processing failed";
			await recordings.update(job.recordingId, { status: "failed" });
			summarizeInput = null;
		}
	}

	// Handle FAILED
	if (newStatus === "FAILED") {
		updateData.errorMessage = pollResult.output.message ?? "Transcription failed";
		await recordings.update(job.recordingId, { status: "failed" });
	}

	// Persist the terminal job state BEFORE running auto-summarize. This
	// closes a race where the next cron tick (fires every minute) would
	// still see PENDING/RUNNING during the up-to-60s summary window, re-poll
	// the same job, and re-run transcription persistence + summary.
	const updatedJob = await jobs.update(job.id, updateData);
	const finalJob = updatedJob ?? job;

	// Auto-summarize AFTER the job is terminal, on its own path. Both
	// sub-steps are guarded internally so nothing thrown here can escape
	// and mislead the caller into thinking the ASR step failed.
	//
	// Scheduling depends on the caller:
	//   - cron tick awaits the combined `autoSummarize` so the enclosing
	//     `ctx.waitUntil` covers the whole chain end-to-end;
	//   - HTTP handlers await ONLY `beginAutoSummarize` (cheap: settings
	//     read + config resolve + one row update flipping the status to
	//     "running"), then hand the long `runAutoSummary` LLM call to the
	//     caller's `waitUntil`. This makes the "running" marker durable
	//     BEFORE the response returns, so the SPA's post-SUCCEEDED reload
	//     never races the background write and always sees "running" in
	//     time to start its summary polling. The 60s AbortSignal inside
	//     `runAutoSummary` bounds the background work either way.
	if (summarizeInput) {
		if (scheduling.mode === "background") {
			const reservation = await beginAutoSummarize(
				summarizeInput.userId,
				job.recordingId,
				summarizeInput.fullText,
				db,
			);
			if (reservation.kind === "started") {
				scheduling.waitUntil(runAutoSummary(reservation, db));
			}
		} else {
			await autoSummarize(summarizeInput.userId, job.recordingId, summarizeInput.fullText, db);
		}
	}

	return {
		job: finalJob,
		previousStatus,
		changed: finalJob.status !== previousStatus,
	};
}

// ── Helpers (moved from route) ──

/**
 * Archive the raw ASR result JSON to OSS.
 */
async function archiveRawResult(jobId: string, rawResult: unknown, env: LyreEnv): Promise<void> {
	if (env.SKIP_OSS_ARCHIVE === "1") return;

	const key = makeResultKey(jobId, "transcription.json");
	const body = JSON.stringify(rawResult);
	const contentType = "application/json";

	const uploadUrl = presignPut(key, contentType, 900, undefined, env);

	const response = await fetch(uploadUrl, {
		method: "PUT",
		headers: { "Content-Type": contentType },
		body,
	});

	if (!response.ok) {
		throw new Error(`OSS upload failed: ${response.status} ${response.statusText}`);
	}
}

/**
 * Result of the preflight+mark-running phase of auto-summarize.
 *
 * - `skipped`: preflight gates said this recording isn't a candidate
 *   (feature off, provider unset, empty transcript). `aiSummaryStatus`
 *   was left at whatever it was before — usually `null`.
 * - `bad-config`: the provider config threw when building the AI client.
 *   The run is already marked `failed` in the DB with the error message.
 *   No follow-up work — callers should NOT invoke `runAutoSummary`.
 * - `started`: `aiSummaryStatus="running"` has been persisted. The
 *   caller MUST invoke `runAutoSummary(reservation, ...)` (either
 *   awaited or via `waitUntil`) so the run doesn't hang in "running"
 *   forever.
 */
export type AutoSummarizeReservation =
	| { kind: "skipped" }
	| { kind: "bad-config" }
	| {
			kind: "started";
			recordingId: string;
			prompt: string;
			config: ReturnType<typeof resolveAiConfig>;
	  };

/**
 * Preflight + reserve "running" for an auto-summary attempt.
 *
 * Everything up to (but NOT including) the LLM call happens here:
 * settings read, gate evaluation, AI config resolution, and — if we
 * decide to run — the DB write that flips `aiSummaryStatus="running"`.
 *
 * Splitting this out matters for the HTTP path: `GET /api/jobs/:id`
 * only returns after this promise resolves, so by the time the SPA
 * receives SUCCEEDED and reloads the recording detail, the "running"
 * marker is already durable. Without this split the SPA would race
 * the background summary and could miss the transition entirely.
 *
 * Fully guarded — any thrown error is caught and persisted as a failed
 * run. The return value tells the caller whether to invoke
 * `runAutoSummary` next.
 */
export async function beginAutoSummarize(
	userId: string,
	recordingId: string,
	fullText: string,
	db: LyreDb,
): Promise<AutoSummarizeReservation> {
	const settings = makeSettingsRepo(db);
	const recordings = makeRecordingsRepo(db);
	const all = await settings.findByUserId(userId);
	const map = new Map<string, string>(
		all.map((s: { key: string; value: string }) => [s.key, s.value]),
	);

	// Preflight gates: never touch aiSummaryStatus if auto-summarize is
	// simply not applicable — leaving status=null preserves the "never
	// attempted" signal so the UI shows a plain Generate button.
	if (map.get("ai.autoSummarize") !== "true") return { kind: "skipped" };

	const provider = map.get("ai.provider") ?? "";
	const apiKey = map.get("ai.apiKey") ?? "";
	const model = map.get("ai.model") ?? "";
	const baseURL = map.get("ai.baseURL") ?? "";
	const sdkType = map.get("ai.sdkType") ?? "";
	const rawAuth = map.get("ai.authType") ?? "";
	const authType = rawAuth === "bearer" || rawAuth === "apiKey" ? rawAuth : undefined;

	if (!provider || !apiKey) return { kind: "skipped" };
	if (!fullText.trim()) return { kind: "skipped" };

	// Config resolution can throw on bad user input (unknown provider,
	// etc.). Treat it as a failed run so the UI surfaces the reason
	// instead of the recording sitting at status=null forever.
	let config: ReturnType<typeof resolveAiConfig>;
	try {
		config = resolveAiConfig({
			provider: provider as AiProvider,
			apiKey,
			model,
			...(baseURL ? { baseURL } : {}),
			...(sdkType ? { sdkType: sdkType as SdkType } : {}),
			...(authType ? { authType } : {}),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[auto-summarize] Config invalid for recording ${recordingId}: ${message}`);
		await recordings.update(recordingId, {
			aiSummaryStatus: "failed",
			aiSummaryError: `AI configuration invalid: ${message}`,
			aiSummary: null,
		});
		return { kind: "bad-config" };
	}

	// From here on the run is committed: mark it running, clear any prior
	// error, and drop the previous summary so the UI shows a fresh state.
	// This write MUST land before the HTTP response returns in the
	// background path — the SPA's post-SUCCEEDED reload keys on it.
	await recordings.update(recordingId, {
		aiSummaryStatus: "running",
		aiSummaryError: null,
		aiSummary: null,
	});

	return {
		kind: "started",
		recordingId,
		prompt: buildSummaryPrompt(fullText),
		config,
	};
}

/**
 * Run the actual LLM call for a reservation from `beginAutoSummarize`.
 *
 * Only accepts a `started` reservation — the type system prevents
 * callers from firing this without the "running" marker in place.
 *
 * Fully guarded: any thrown error is caught and persisted to
 * `aiSummaryStatus="failed"`. Safe to hand to `waitUntil` on the HTTP
 * path.
 *
 * `generate` defaults to Vercel AI SDK's `generateText` but is
 * injectable so tests can drive it without a live LLM.
 */
export async function runAutoSummary(
	reservation: Extract<AutoSummarizeReservation, { kind: "started" }>,
	db: LyreDb,
	generate: typeof generateText = generateText,
): Promise<void> {
	const recordings = makeRecordingsRepo(db);
	const { recordingId, prompt, config } = reservation;

	try {
		const client = createAiModel(config);

		// Hard timeout so this await can never wedge the cron tick. 60s
		// is generous — a real generation usually finishes in <10s.
		const { text } = await generate({
			model: client,
			prompt,
			maxOutputTokens: 2048,
			abortSignal: AbortSignal.timeout(60_000),
		});

		const summary = text.trim();
		if (!summary) {
			throw new Error("AI returned an empty response");
		}

		await recordings.update(recordingId, {
			aiSummary: summary,
			aiSummaryStatus: "succeeded",
			aiSummaryError: null,
		});
		console.log(`[auto-summarize] Summary generated for recording ${recordingId}`);
	} catch (err) {
		const message =
			err instanceof Error
				? err.name === "TimeoutError" || err.name === "AbortError"
					? "AI request timed out after 60s"
					: err.message
				: String(err);
		console.warn(`[auto-summarize] Failed for recording ${recordingId}: ${message}`);
		await recordings.update(recordingId, {
			aiSummaryStatus: "failed",
			aiSummaryError: message,
			aiSummary: null,
		});
	}
}

/**
 * Auto-summarize a recording after transcription completes.
 *
 * Combines `beginAutoSummarize` + `runAutoSummary` end-to-end. This is
 * the callable used by the cron path (where the enclosing
 * `ctx.waitUntil` covers the whole chain) and by anything that wants
 * the "old" all-in-one shape. HTTP callers should invoke the two
 * halves separately so the "running" marker is durable before the
 * response returns.
 *
 * Fully guarded — no error escapes the top-level try.
 *
 * The `generate` parameter defaults to Vercel AI SDK's `generateText`
 * but is injectable so tests can drive it without a live LLM.
 */
export async function autoSummarize(
	userId: string,
	recordingId: string,
	fullText: string,
	db: LyreDb,
	generate: typeof generateText = generateText,
): Promise<void> {
	const reservation = await beginAutoSummarize(userId, recordingId, fullText, db);
	if (reservation.kind !== "started") return;
	await runAutoSummary(reservation, db, generate);
}
