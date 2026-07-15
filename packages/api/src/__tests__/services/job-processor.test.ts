/**
 * Tests for the auto-summarize path inside job-processor.
 *
 * Focuses on the state-machine contract observed via
 * `recordings.aiSummaryStatus` / `aiSummary` / `aiSummaryError`:
 *
 *   - Preflight gates (autoSummarize disabled, no provider, empty transcript)
 *     leave status untouched at `null` — the recording is "never attempted".
 *   - A committed run flips through `running` → `succeeded` on happy path.
 *   - Failures land on `status=failed` with a human-readable error, and
 *     clear any partial `aiSummary` (nothing half-written survives).
 *   - Abort/timeout errors surface a friendly message.
 *
 * Also covers the HTTP-vs-cron scheduling seam on pollJob: background
 * mode must hand the summary promise to the caller's waitUntil instead
 * of blocking the return.
 */

import type { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { makeSettingsRepo } from "../../db/repositories";
import type {
	AsrPollResponse,
	AsrProvider,
	AsrSubmitResponse,
	AsrTranscriptionResult,
} from "../../services/asr";
import { autoSummarize, pollJob } from "../../services/job-processor";
import { makeTestEnv, seedTestUser, testRepos } from "../_fixtures/runtime-context";
import { getTestDb } from "../_fixtures/test-db";

async function seedRecording(userId: string, id = "rec-1"): Promise<void> {
	await testRepos().recordings.create({
		id,
		userId,
		title: "t",
		description: null,
		fileName: "a.m4a",
		fileSize: null,
		duration: null,
		format: null,
		sampleRate: null,
		ossKey: "k",
		status: "completed",
	});
}

async function configureAi(userId: string): Promise<void> {
	const settings = makeSettingsRepo(getTestDb());
	await settings.upsert(userId, "ai.autoSummarize", "true");
	await settings.upsert(userId, "ai.provider", "anthropic");
	await settings.upsert(userId, "ai.apiKey", "sk-test");
	await settings.upsert(userId, "ai.model", "claude-3-5-haiku-20241022");
}

/** Type-compatible stub matching the `generateText` signature we use. */
function stubGenerate(impl: () => Promise<{ text: string }>): typeof generateText {
	return impl as unknown as typeof generateText;
}

describe("autoSummarize", () => {
	it("no-ops when auto-summarize is disabled (status stays null)", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		// Settings has no `ai.autoSummarize` key → gate returns early.

		const called = { count: 0 };
		await autoSummarize(
			user.id,
			"rec-1",
			"some transcript",
			getTestDb(),
			stubGenerate(async () => {
				called.count++;
				return { text: "shouldn't be called" };
			}),
		);

		expect(called.count).toBe(0);
		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBeNull();
		expect(rec?.aiSummary).toBeNull();
		expect(rec?.aiSummaryError).toBeNull();
	});

	it("no-ops when provider or apiKey missing (status stays null)", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		const settings = makeSettingsRepo(getTestDb());
		await settings.upsert(user.id, "ai.autoSummarize", "true");
		// provider + apiKey deliberately absent

		const called = { count: 0 };
		await autoSummarize(
			user.id,
			"rec-1",
			"some transcript",
			getTestDb(),
			stubGenerate(async () => {
				called.count++;
				return { text: "" };
			}),
		);

		expect(called.count).toBe(0);
		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBeNull();
	});

	it("no-ops on empty transcript (status stays null)", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		await configureAi(user.id);

		const called = { count: 0 };
		await autoSummarize(
			user.id,
			"rec-1",
			"   \n\t  ",
			getTestDb(),
			stubGenerate(async () => {
				called.count++;
				return { text: "" };
			}),
		);

		expect(called.count).toBe(0);
		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBeNull();
	});

	it("writes succeeded state and the summary text on happy path", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		await configureAi(user.id);

		await autoSummarize(
			user.id,
			"rec-1",
			"hello world transcript",
			getTestDb(),
			stubGenerate(async () => ({ text: "Short summary of hello world." })),
		);

		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBe("succeeded");
		expect(rec?.aiSummary).toBe("Short summary of hello world.");
		expect(rec?.aiSummaryError).toBeNull();
	});

	it("clears any prior summary while running and restores nothing on failure", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		// Seed a prior summary that must be cleared during a fresh run.
		await testRepos().recordings.update("rec-1", {
			aiSummary: "stale content",
			aiSummaryStatus: "succeeded",
		});
		await configureAi(user.id);

		await autoSummarize(
			user.id,
			"rec-1",
			"hello world transcript",
			getTestDb(),
			stubGenerate(async () => {
				throw new Error("provider is on fire");
			}),
		);

		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBe("failed");
		expect(rec?.aiSummary).toBeNull();
		expect(rec?.aiSummaryError).toContain("provider is on fire");
	});

	it("reports empty AI response as a failed run, not silent success", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		await configureAi(user.id);

		await autoSummarize(
			user.id,
			"rec-1",
			"hello world transcript",
			getTestDb(),
			stubGenerate(async () => ({ text: "   " })),
		);

		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBe("failed");
		expect(rec?.aiSummary).toBeNull();
		expect(rec?.aiSummaryError).toMatch(/empty/i);
	});

	it("surfaces a friendly timeout message for AbortError", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		await configureAi(user.id);

		await autoSummarize(
			user.id,
			"rec-1",
			"hello world transcript",
			getTestDb(),
			stubGenerate(async () => {
				const err = new Error("aborted");
				err.name = "AbortError";
				throw err;
			}),
		);

		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.aiSummaryStatus).toBe("failed");
		expect(rec?.aiSummaryError).toMatch(/timed out/i);
	});
});

// ── pollJob scheduling seam ──

/**
 * Minimal AsrProvider stub whose poll() returns SUCCEEDED and whose
 * fetchResult() returns a parseable payload with one sentence.
 */
function makeSuccessProvider(): AsrProvider {
	return {
		async submit(): Promise<AsrSubmitResponse> {
			throw new Error("submit not used in pollJob tests");
		},
		async poll(taskId: string): Promise<AsrPollResponse> {
			return {
				request_id: "req-1",
				output: {
					task_id: taskId,
					task_status: "SUCCEEDED",
					result: { transcription_url: "https://example.invalid/result.json" },
				},
			};
		},
		async fetchResult(): Promise<AsrTranscriptionResult> {
			return {
				file_url: "https://example.invalid/audio.m4a",
				audio_info: { format: "m4a", sample_rate: 48000 },
				transcripts: [
					{
						channel_id: 0,
						text: "hello world",
						sentences: [
							{
								sentence_id: 0,
								begin_time: 0,
								end_time: 500,
								language: "en",
								emotion: "neutral",
								text: "hello world",
								words: [],
							},
						],
					},
				],
			};
		},
	};
}

describe("pollJob scheduling seam", () => {
	it("background mode marks aiSummaryStatus=running BEFORE returning, defers AI call to waitUntil", async () => {
		const user = await seedTestUser();
		await seedRecording(user.id);
		await configureAi(user.id);
		// SKIP the OSS archive so the stub doesn't need to serve presigns.
		const env = makeTestEnv({ SKIP_OSS_ARCHIVE: "1" });
		const db = getTestDb();

		// Create the ASR job in RUNNING state — pollJob will see this and
		// flip it to SUCCEEDED on the stubbed poll response.
		const jobRow = await testRepos().jobs.create({
			id: "job-1",
			recordingId: "rec-1",
			taskId: "task-1",
			requestId: null,
			status: "RUNNING",
		});

		const backgroundTasks: Promise<unknown>[] = [];
		const t0 = performance.now();
		const result = await pollJob(jobRow, makeSuccessProvider(), env, db, {
			mode: "background",
			waitUntil: (p) => backgroundTasks.push(p),
		});
		const elapsed = performance.now() - t0;

		// pollJob returned before waiting on the AI call. Bound is generous
		// so slow CI doesn't false-positive; the meaningful signal is
		// "waitUntil was handed a promise and it hasn't been awaited."
		expect(elapsed).toBeLessThan(500);
		expect(result.job.status).toBe("SUCCEEDED");
		expect(result.changed).toBe(true);
		expect(backgroundTasks).toHaveLength(1);

		// Both durable-before-return signals must hold:
		//   1. Recording status is `completed` (ASR terminal).
		//   2. aiSummaryStatus is `running` — the SPA's post-SUCCEEDED
		//      reload can now start its 3s summary poll without racing
		//      the background AI call.
		const midRec = await testRepos().recordings.findById("rec-1");
		expect(midRec?.status).toBe("completed");
		expect(midRec?.aiSummaryStatus).toBe("running");
		expect(midRec?.aiSummary).toBeNull();

		// Drain background work so the test doesn't leak an in-flight
		// promise. We don't care whether the AI call succeeded or failed;
		// runAutoSummary is fully guarded either way.
		await Promise.allSettled(backgroundTasks);
	});

	it("background mode with auto-summary disabled leaves aiSummaryStatus null and skips waitUntil", async () => {
		// Preflight-skip path: no config means no run committed, so nothing
		// is handed to waitUntil. The SPA sees aiSummaryStatus=null and
		// shows a plain Generate button.
		const user = await seedTestUser();
		await seedRecording(user.id);
		// Deliberately DO NOT configure AI.
		const env = makeTestEnv({ SKIP_OSS_ARCHIVE: "1" });
		const db = getTestDb();

		const jobRow = await testRepos().jobs.create({
			id: "job-1",
			recordingId: "rec-1",
			taskId: "task-1",
			requestId: null,
			status: "RUNNING",
		});

		const backgroundTasks: Promise<unknown>[] = [];
		const result = await pollJob(jobRow, makeSuccessProvider(), env, db, {
			mode: "background",
			waitUntil: (p) => backgroundTasks.push(p),
		});

		expect(result.job.status).toBe("SUCCEEDED");
		expect(backgroundTasks).toHaveLength(0);
		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.status).toBe("completed");
		expect(rec?.aiSummaryStatus).toBeNull();
	});

	it("await mode blocks until autoSummarize completes", async () => {
		// Cron path parity: default scheduling keeps the summary in the
		// pollJob promise chain so the enclosing `ctx.waitUntil` in the
		// Worker's scheduled() handler covers it.
		const user = await seedTestUser();
		await seedRecording(user.id);
		// Deliberately DO NOT configure AI — autoSummarize will hit the
		// preflight gate and return quickly without touching the network.
		const env = makeTestEnv({ SKIP_OSS_ARCHIVE: "1" });
		const db = getTestDb();

		const jobRow = await testRepos().jobs.create({
			id: "job-1",
			recordingId: "rec-1",
			taskId: "task-1",
			requestId: null,
			status: "RUNNING",
		});

		const result = await pollJob(jobRow, makeSuccessProvider(), env, db);
		expect(result.job.status).toBe("SUCCEEDED");
		const rec = await testRepos().recordings.findById("rec-1");
		expect(rec?.status).toBe("completed");
		// Preflight gate left aiSummaryStatus at null.
		expect(rec?.aiSummaryStatus).toBeNull();
	});
});
