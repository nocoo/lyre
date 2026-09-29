import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_LOCAL_TRANSCRIPTION_BYTES, parseLocalTranscription } from "../../contracts/recordings";
import {
	createRecordingHandler,
	getRecordingHandler,
	transcribeRecordingHandler,
	wordsHandler,
} from "../../handlers/recordings";
import { presignUploadHandler } from "../../handlers/upload";
import { resetAsrProvider, setAsrProvider } from "../../services/asr-provider";
import { makeCtx, setupAuthedCtx, testRepos } from "../_fixtures/runtime-context";

const generate = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	generateText: generate,
}));

const local = {
	result: { language: "zh" },
	model: { type: "large-v3" },
	transcription: [
		{ offsets: { from: 0, to: 1250 }, text: " 第一段。 " },
		{ offsets: { from: 1300, to: 2400 }, text: "第二段。" },
	],
};
const input = {
	id: "local-recording",
	title: "Meeting",
	fileName: "meeting.m4a",
	ossKey: "uploads/test-user-1/local-recording/meeting.m4a",
	duration: 3,
	localTranscription: local,
	autoTranscribe: true,
};
const ossEnv = {
	OSS_ACCESS_KEY_ID: "ak",
	OSS_ACCESS_KEY_SECRET: "sk",
	OSS_BUCKET: "bucket",
	OSS_REGION: "oss-cn",
	OSS_ENDPOINT: "https://oss.example.com",
};

const submit = vi.fn(async () => ({
	request_id: "request",
	output: { task_id: "cloud-task", task_status: "PENDING" as const },
}));
const poll = vi.fn();
const fetchResult = vi.fn();

beforeEach(() => {
	generate.mockReset();
	submit.mockClear();
	setAsrProvider({ submit, poll, fetchResult });
});
afterEach(() => {
	resetAsrProvider();
	vi.restoreAllMocks();
});

async function configureAi() {
	const { settings } = testRepos();
	await settings.upsert("test-user-1", "ai.autoSummarize", "true");
	await settings.upsert("test-user-1", "ai.provider", "anthropic");
	await settings.upsert("test-user-1", "ai.apiKey", "test-key");
	await settings.upsert("test-user-1", "ai.model", "claude-3-5-haiku-20241022");
}

describe("whisper JSON validation", () => {
	it("preserves milliseconds, language, sentence IDs, and model", () => {
		expect(parseLocalTranscription(local, 3)).toEqual({
			fullText: "第一段。\n第二段。",
			language: "zh",
			model: "large-v3",
			sentences: [
				{
					sentenceId: 0,
					channelId: 0,
					beginTime: 0,
					endTime: 1250,
					text: "第一段。",
					language: "zh",
					emotion: "",
				},
				{
					sentenceId: 1,
					channelId: 0,
					beginTime: 1300,
					endTime: 2400,
					text: "第二段。",
					language: "zh",
					emotion: "",
				},
			],
		});
	});
	it("accepts silence, blank segments, zero-length segments, and absent model", () => {
		expect(
			parseLocalTranscription({ result: { language: "en" }, transcription: [] }).fullText,
		).toBe("");
		const parsed = parseLocalTranscription({
			result: { language: "en" },
			transcription: [
				{ offsets: { from: 0, to: 0 }, text: " " },
				{ offsets: { from: 0, to: 0 }, text: "hello" },
			],
		});
		expect(parsed.model).toBe("unknown");
		expect(parsed.sentences).toHaveLength(1);
		expect(parsed.sentences[0]?.sentenceId).toBe(0);
	});
	it.each([
		null,
		[],
		{},
		{ result: { language: "" }, transcription: [] },
		{ result: { language: 1 }, transcription: [] },
		{ ...local, transcription: "bad" },
		{ ...local, model: "large-v3" },
		{ ...local, model: { type: "bad/model" } },
		{ ...local, transcription: [null] },
		{ ...local, transcription: [{ offsets: {}, text: "hello" }] },
		{ ...local, transcription: [{ offsets: { from: 0, to: 1 }, text: 5 }] },
	])("rejects malformed JSON shape %#", (value) => {
		expect(() => parseLocalTranscription(value)).toThrow();
	});
	it.each([
		[-1, 0],
		[1, 0],
		[0, NaN],
		[0, Infinity],
		[0.1, 1],
		[0, 4001],
	])("rejects invalid time interval %s..%s", (from, to) => {
		expect(() =>
			parseLocalTranscription(
				{ ...local, transcription: [{ offsets: { from, to }, text: "hello" }] },
				3,
			),
		).toThrow();
	});
	it("rejects decreasing segments and invalid duration, permits a one-second end tolerance", () => {
		expect(() =>
			parseLocalTranscription({ ...local, transcription: [...local.transcription].reverse() }),
		).toThrow();
		for (const duration of [-1, NaN, Infinity])
			expect(() => parseLocalTranscription(local, duration)).toThrow();
		expect(
			parseLocalTranscription(
				{ ...local, transcription: [{ offsets: { from: 0, to: 4000 }, text: "hello" }] },
				3,
			).sentences[0]?.endTime,
		).toBe(4000);
	});
	it("bounds bytes, segment count, text length, and language", () => {
		for (const value of [
			{ ...local, params: "x".repeat(MAX_LOCAL_TRANSCRIPTION_BYTES) },
			{
				...local,
				transcription: Array.from({ length: 50_001 }, () => ({
					offsets: { from: 0, to: 0 },
					text: "",
				})),
			},
			{ ...local, transcription: [{ offsets: { from: 0, to: 1 }, text: "x".repeat(100_001) }] },
			{ ...local, result: { language: "x".repeat(33) } },
		])
			expect(() => parseLocalTranscription(value)).toThrow();
	});
});

describe("local transcription ingestion", () => {
	it("creates completed recording, job, and sentences without ASR or OSS result fetch", async () => {
		const { ctx } = await setupAuthedCtx();
		const fetch = vi.spyOn(globalThis, "fetch");
		expect((await createRecordingHandler(ctx, input)).status).toBe(201);
		const detail = await getRecordingHandler(ctx, input.id);
		expect(detail.kind === "json" && detail.body).toMatchObject({
			status: "completed",
			transcription: {
				fullText: "第一段。\n第二段。",
				sentences: [
					{ beginTime: 0, endTime: 1250 },
					{ beginTime: 1300, endTime: 2400 },
				],
			},
			latestJob: { status: "SUCCEEDED", taskId: "local:whisper.cpp:large-v3" },
		});
		const words = await wordsHandler(ctx, input.id);
		expect(words.kind === "json" && words.body).toEqual({ sentences: [] });
		expect(await testRepos().jobs.findActive()).toEqual([]);
		expect(submit).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
	it("makes concurrent retries idempotent", async () => {
		const { ctx } = await setupAuthedCtx();
		const responses = await Promise.all([
			createRecordingHandler(ctx, input),
			createRecordingHandler(ctx, input),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
		expect((await createRecordingHandler(ctx, input)).status).toBe(200);
		expect(await testRepos().jobs.findByRecordingId(input.id)).toHaveLength(1);
		expect(submit).not.toHaveBeenCalled();
	});
	it("rejects a retry with changed local transcript content", async () => {
		const { ctx } = await setupAuthedCtx();
		await createRecordingHandler(ctx, input);
		expect(
			(
				await createRecordingHandler(ctx, {
					...input,
					localTranscription: {
						...local,
						transcription: [{ offsets: { from: 0, to: 1250 }, text: "Different" }],
					},
				})
			).status,
		).toBe(409);
		expect((await testRepos().transcriptions.findByRecordingId(input.id))?.fullText).toBe(
			"第一段。\n第二段。",
		);
	});

	it("rejects invalid local JSON without creating an upload or falling back silently", async () => {
		const { ctx } = await setupAuthedCtx();
		expect((await createRecordingHandler(ctx, { ...input, localTranscription: {} })).status).toBe(
			400,
		);
		expect(await testRepos().recordings.findById(input.id)).toBeUndefined();
		expect(submit).not.toHaveBeenCalled();
	});
	it("retains a successful silent transcript and skips AI and cloud ASR", async () => {
		const { ctx } = await setupAuthedCtx();
		await configureAi();
		expect(
			(
				await createRecordingHandler(ctx, {
					...input,
					localTranscription: { result: { language: "en" }, transcription: [] },
				})
			).status,
		).toBe(201);
		expect((await testRepos().transcriptions.findByRecordingId(input.id))?.fullText).toBe("");
		expect((await testRepos().recordings.findById(input.id))?.status).toBe("completed");
		expect(generate).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});
	it("rejects another owner and a reused ID with a different key", async () => {
		const { ctx, user } = await setupAuthedCtx();
		await createRecordingHandler(ctx, input);
		const other = makeCtx({ ...user, id: "other" });
		expect((await createRecordingHandler(other, input)).status).toBe(400);
		expect(
			(
				await createRecordingHandler(other, {
					...input,
					ossKey: "uploads/other/local-recording/meeting.m4a",
				})
			).status,
		).toBe(409);
		expect(
			(
				await createRecordingHandler(ctx, {
					...input,
					fileName: "other.m4a",
					ossKey: "uploads/test-user-1/local-recording/other.m4a",
				})
			).status,
		).toBe(409);
	});
	it("rolls back atomic local creation when a database constraint rejects it", async () => {
		const { ctx } = await setupAuthedCtx();
		expect(
			(await createRecordingHandler(ctx, { ...input, folderId: "missing-folder" })).status,
		).toBe(500);
		expect(await testRepos().recordings.findById(input.id)).toBeUndefined();
		expect(await testRepos().jobs.findByRecordingId(input.id)).toEqual([]);
		expect(await testRepos().transcriptions.findByRecordingId(input.id)).toBeUndefined();
	});
	it("publishes a durable summary running marker and schedules exactly one run across retries", async () => {
		const { ctx } = await setupAuthedCtx();
		await configureAi();
		let finish: (value: { text: string }) => void = () => {};
		generate.mockImplementation(
			() =>
				new Promise<{ text: string }>((resolve) => {
					finish = resolve;
				}),
		);
		const tasks: Promise<unknown>[] = [];
		ctx.waitUntil = (task) => {
			tasks.push(task);
		};
		const responses = await Promise.all([
			createRecordingHandler(ctx, input),
			createRecordingHandler(ctx, input),
		]);
		for (const response of responses)
			expect(response.kind === "json" && response.body).toMatchObject({
				aiSummaryStatus: "running",
			});
		expect(tasks).toHaveLength(1);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(generate.mock.calls[0]?.[0].prompt).toContain("第一段。\n第二段。");
		finish({ text: " Summary " });
		await Promise.all(tasks);
		await createRecordingHandler(ctx, input);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await testRepos().recordings.findById(input.id)).toMatchObject({
			aiSummary: "Summary",
			aiSummaryStatus: "succeeded",
		});
	});
	it("preserves completed local STT when AI fails and does not retry AI on upload replay", async () => {
		const { ctx } = await setupAuthedCtx();
		await configureAi();
		generate.mockRejectedValue(new Error("provider unavailable"));
		await createRecordingHandler(ctx, input);
		await createRecordingHandler(ctx, input);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await testRepos().recordings.findById(input.id)).toMatchObject({
			status: "completed",
			aiSummaryStatus: "failed",
			aiSummaryError: "provider unavailable",
		});
	});
	it("records invalid AI configuration without triggering cloud ASR", async () => {
		const { ctx } = await setupAuthedCtx();
		await configureAi();
		await testRepos().settings.upsert("test-user-1", "ai.provider", "invalid");
		await createRecordingHandler(ctx, input);
		await createRecordingHandler(ctx, input);
		expect(await testRepos().recordings.findById(input.id)).toMatchObject({
			status: "completed",
			aiSummaryStatus: "failed",
		});
		expect(generate).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});
});

describe("cloud fallback and explicit retranscription", () => {
	it("submits cloud fallback once and returns the existing active job", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: ossEnv });
		const { localTranscription: _, ...fallback } = input;
		const responses = await Promise.all([
			createRecordingHandler(ctx, fallback),
			createRecordingHandler(ctx, fallback),
		]);
		for (const response of responses) expect(response.status).toBeLessThan(300);
		await createRecordingHandler(ctx, fallback);
		expect((await transcribeRecordingHandler(ctx, input.id)).status).toBe(200);
		expect(submit).toHaveBeenCalledTimes(1);
		expect((await testRepos().recordings.findById(input.id))?.status).toBe("transcribing");
	});
	it("leaves uploads unsubmitted when autoTranscribe is absent", async () => {
		const { ctx } = await setupAuthedCtx();
		const { localTranscription: _, autoTranscribe: __, ...upload } = input;
		await createRecordingHandler(ctx, upload);
		expect((await testRepos().recordings.findById(input.id))?.status).toBe("uploaded");
		expect(submit).not.toHaveBeenCalled();
	});
	it("records cloud submission failure and avoids resubmitting on upload replay", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: ossEnv });
		submit.mockRejectedValueOnce(new Error("cloud offline"));
		const { localTranscription: _, ...fallback } = input;
		expect((await createRecordingHandler(ctx, fallback)).status).toBe(201);
		await createRecordingHandler(ctx, fallback);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(await testRepos().recordings.findById(input.id)).toMatchObject({ status: "failed" });
		expect(await testRepos().jobs.findLatestByRecordingId(input.id)).toMatchObject({
			status: "FAILED",
			errorMessage: "cloud offline",
		});
	});
	it("prevents concurrent fallback retries from repeating a failed submission", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: ossEnv });
		submit.mockRejectedValueOnce(new Error("cloud offline"));
		const { localTranscription: _, ...fallback } = input;
		await Promise.all([
			createRecordingHandler(ctx, fallback),
			createRecordingHandler(ctx, fallback),
		]);
		expect(submit).toHaveBeenCalledTimes(1);
		expect((await transcribeRecordingHandler(ctx, input.id)).status).toBe(200);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("selects the newest job when two jobs share a millisecond", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: ossEnv });
		vi.spyOn(Date, "now").mockReturnValue(123456);
		await createRecordingHandler(ctx, input);
		await transcribeRecordingHandler(ctx, input.id, { force: true });
		expect(await testRepos().jobs.findLatestByRecordingId(input.id)).toMatchObject({
			taskId: "cloud-task",
			status: "PENDING",
		});
	});

	it("requires force for completed local jobs and prevents duplicate forced submissions", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: ossEnv });
		await createRecordingHandler(ctx, input);
		expect((await transcribeRecordingHandler(ctx, input.id)).status).toBe(200);
		expect(submit).not.toHaveBeenCalled();
		expect((await transcribeRecordingHandler(ctx, input.id, { force: true })).status).toBe(201);
		expect((await transcribeRecordingHandler(ctx, input.id, { force: true })).status).toBe(200);
		expect(submit).toHaveBeenCalledTimes(1);
	});
});

describe("presign retry ownership", () => {
	it("renews the same upload key and rejects changes or traversal", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: ossEnv });
		const args = { fileName: input.fileName, recordingId: input.id, contentType: "audio/mp4" };
		const first = await presignUploadHandler(ctx, args);
		expect(first.kind === "json" && first.body).toMatchObject({
			recordingId: input.id,
			ossKey: input.ossKey,
		});
		await createRecordingHandler(ctx, input);
		expect((await presignUploadHandler(ctx, args)).status).toBe(200);
		expect(
			(await presignUploadHandler(makeCtx({ ...user, id: "other" }, { env: ossEnv }), args)).status,
		).toBe(409);
		expect((await presignUploadHandler(ctx, { ...args, fileName: "changed.m4a" })).status).toBe(
			409,
		);
		for (const fileName of [
			"../file.m4a",
			"a/b.m4a",
			"a\\b.m4a",
			".",
			"..",
			"a%2Fm4a",
			"a?x",
			"a#x",
			"a\u0000",
			"x".repeat(256),
		])
			expect((await presignUploadHandler(ctx, { ...args, fileName })).status).toBe(400);
		for (const recordingId of ["../other", "", "x".repeat(129)])
			expect((await presignUploadHandler(ctx, { ...args, recordingId })).status).toBe(400);
	});
});
