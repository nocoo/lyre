import { expect, test } from "@playwright/test";

const BASE = "http://localhost:27016";

const localTranscription = {
	model: { type: "large" },
	result: { language: "zh" },
	transcription: [
		{ offsets: { from: 900, to: 4400 }, text: "第一句话。" },
		{ offsets: { from: 7900, to: 9100 }, text: "Second sentence." },
	],
};

function silentWav(): Buffer {
	const frames = 12 * 16000;
	const data = Buffer.alloc(44 + frames * 2);
	data.write("RIFF", 0);
	data.writeUInt32LE(data.length - 8, 4);
	data.write("WAVEfmt ", 8);
	data.writeUInt32LE(16, 16);
	data.writeUInt16LE(1, 20);
	data.writeUInt16LE(1, 22);
	data.writeUInt32LE(16000, 24);
	data.writeUInt32LE(32000, 28);
	data.writeUInt16LE(2, 32);
	data.writeUInt16LE(16, 34);
	data.write("data", 36);
	data.writeUInt32LE(frames * 2, 40);
	return data;
}

test("local sentences seek accurately and summary polling needs no cloud ASR", async ({
	page,
	request,
}) => {
	const recordingId = crypto.randomUUID();
	const response = await request.post("/api/recordings", {
		headers: { Origin: BASE },
		data: {
			title: "Local Whisper browser fixture",
			fileName: "local.wav",
			ossKey: `uploads/e2e-test-user/${recordingId}/local.wav`,
			id: recordingId,
			duration: 12,
			autoTranscribe: true,
			localTranscription,
		},
	});
	expect(response.status(), await response.text()).toBe(201);
	const { id } = await response.json();
	const detail = await (await request.get(`/api/recordings/${id}`)).json();
	expect(detail.status).toBe("completed");
	expect(detail.transcription.sentences[1].beginTime).toBe(7900);
	let detailReads = 0;
	let cloudSubmissions = 0;
	let wordRequests = 0;
	page.on("request", (req) => {
		if (req.url().endsWith("/transcribe")) cloudSubmissions++;
		if (req.url().endsWith("/words")) wordRequests++;
	});
	await page.route(`**/api/recordings/${id}`, (route) => {
		detailReads++;
		return route.fulfill({
			json: {
				...detail,
				aiSummaryStatus: detailReads === 1 ? "running" : "succeeded",
				aiSummary: detailReads === 1 ? null : "Local transcript summary completed.",
			},
		});
	});
	await page.route(`**/api/recordings/${id}/play-url`, (route) =>
		route.fulfill({ json: { playUrl: `data:audio/wav;base64,${silentWav().toString("base64")}` } }),
	);
	await page.route("https://s.zhe.to/**", (route) => route.abort());
	await page.goto(`/recordings/${id}`);
	await expect(page.getByText("· Local Whisper")).toBeVisible();
	await expect(page.getByText("Whisper · Local", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Expand word details" })).toHaveCount(0);
	await expect
		.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.readyState))
		.toBeGreaterThan(0);
	const second = page.getByRole("button", { name: "Play sentence at 0:07.9" });
	await second.click();
	await expect
		.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime))
		.toBeCloseTo(7.9, 2);
	await expect(second.locator("../..")).toHaveClass(/bg-basalt-accent/);
	await expect(page.getByText("Local transcript summary completed.")).toBeVisible({
		timeout: 15000,
	});
	expect(detailReads).toBeGreaterThan(1);
	expect(cloudSubmissions).toBe(0);
	expect(wordRequests).toBe(0);
	await request.delete(`/api/recordings/${id}`, { headers: { Origin: BASE } });
});

test("JSON upload validates before transfer and retries reuse the completed local job", async ({
	page,
	request,
}) => {
	const id = crypto.randomUUID();
	const presignIds: Array<string | undefined> = [];
	let creates = 0;
	let cloudSubmissions = 0;
	page.on("request", (req) => {
		if (req.url().endsWith("/transcribe")) cloudSubmissions++;
	});
	await page.route("https://s.zhe.to/**", (route) => route.abort());
	await page.route("**/api/upload/presign", (route) => {
		presignIds.push(route.request().postDataJSON().recordingId);
		return route.fulfill({
			json: {
				recordingId: id,
				ossKey: `uploads/e2e-test-user/${id}/local.wav`,
				uploadUrl: `${BASE}/_test/local-audio`,
			},
		});
	});
	await page.route("**/_test/local-audio", (route) => route.fulfill({ status: 200 }));
	await page.route("**/api/recordings", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		const body = route.request().postDataJSON();
		expect(body.localTranscription).toEqual(localTranscription);
		expect(body.autoTranscribe).toBe(true);
		const response = await route.fetch();
		creates++;
		expect(response.status()).toBe(creates === 1 ? 201 : 200);
		if (creates === 1)
			return route.fulfill({ status: 503, json: { error: "Upload response interrupted" } });
		return route.fulfill({ response });
	});
	try {
		await page.goto("/recordings");
		await page.getByRole("button", { name: "Upload", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.locator("#audio-file").setInputFiles({
			name: "local.wav",
			mimeType: "audio/wav",
			buffer: silentWav(),
		});
		const jsonInput = dialog.locator('input[accept=".json,application/json"]');
		await jsonInput.setInputFiles({
			name: "bad.json",
			mimeType: "application/json",
			buffer: Buffer.from("not JSON"),
		});
		await dialog.getByRole("button", { name: "Upload", exact: true }).click();
		await expect(dialog.getByText(/Could not read transcript JSON/)).toBeVisible();
		expect(presignIds).toHaveLength(0);
		await jsonInput.setInputFiles({
			name: "transcript.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(localTranscription)),
		});
		await dialog.getByRole("button", { name: "Retry upload" }).click();
		await expect(dialog.getByText("Upload response interrupted")).toBeVisible();
		const beforeRetry = await (await request.get(`/api/recordings/${id}`)).json();
		expect(beforeRetry.status).toBe("completed");
		await dialog.getByRole("button", { name: "Retry upload" }).click();
		await expect(dialog.getByText("Upload complete!")).toBeVisible();
		const afterRetry = await (await request.get(`/api/recordings/${id}`)).json();
		expect(afterRetry.latestJob.id).toBe(beforeRetry.latestJob.id);
		expect(afterRetry.transcription.sentences[1].beginTime).toBe(7900);
		expect(presignIds).toEqual([undefined, id]);
		expect(creates).toBe(2);
		expect(cloudSubmissions).toBe(0);
	} finally {
		await request.delete(`/api/recordings/${id}`, { headers: { Origin: BASE } });
	}
});
