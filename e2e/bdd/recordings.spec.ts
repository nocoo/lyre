import { type APIRequestContext, expect, test } from "@playwright/test";

const BASE = "http://localhost:27016";

// Same-origin Origin header so the Worker's csrfGuard accepts unsafe-method
// writes — mirrors what a real browser would send from the SPA on BASE.
const ORIGIN_HEADERS = { Origin: BASE } as const;

async function createRecording(request: APIRequestContext): Promise<string> {
	const res = await request.post(`${BASE}/api/recordings`, {
		headers: ORIGIN_HEADERS,
		data: {
			title: "E2E Test Recording",
			fileName: "e2e-test.m4a",
			ossKey: "test/e2e-test.m4a",
		},
	});
	expect(res.ok()).toBeTruthy();
	const body = (await res.json()) as { id: string };
	return body.id;
}

async function deleteRecording(request: APIRequestContext, id: string): Promise<void> {
	await request.delete(`${BASE}/api/recordings/${id}`, {
		headers: ORIGIN_HEADERS,
	});
}

test.describe("Recordings", () => {
	let recordingId: string;

	test("list page shows created recording", async ({ page, request }) => {
		recordingId = await createRecording(request);

		await page.goto("/recordings");
		await expect(
			page.getByRole("heading", { name: "Recordings", exact: true, level: 1 }),
		).toBeVisible();
		await expect(page.getByText("E2E Test Recording").first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test("detail page renders recording metadata", async ({ page, request }) => {
		if (!recordingId) recordingId = await createRecording(request);

		await page.goto(`/recordings/${recordingId}`);
		await expect(page.getByText("E2E Test Recording").first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test.afterAll(async ({ request }) => {
		if (recordingId) await deleteRecording(request, recordingId);
	});
});
