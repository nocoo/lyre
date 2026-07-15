/**
 * L2 E2E test: exercise `csrfGuard` against a real wrangler dev Worker.
 *
 * The helpers in `./helpers` always send a same-origin `Origin` header, so
 * those tests exercise the happy path. This file goes around the helpers
 * to send raw `fetch` requests that mimic a browser cross-origin POST and
 * a browser POST that omits Origin entirely — both should be rejected
 * with 403 by the middleware.
 */

import { describe, expect, test } from "bun:test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:7017";

describe("csrfGuard (L2 e2e via wrangler dev)", () => {
	test("POST /api/recordings with cross-origin Origin → 403", async () => {
		const res = await fetch(`${BASE}/api/recordings`, {
			method: "POST",
			headers: {
				Origin: "https://evil.example",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				title: "csrf-cross-origin",
				fileName: "x.m4a",
				ossKey: "uploads/csrf/x.m4a",
			}),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("forbidden_origin");
	});

	test("POST /api/recordings with no Origin and no Referer → 403", async () => {
		const res = await fetch(`${BASE}/api/recordings`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: "csrf-missing-origin",
				fileName: "x.m4a",
				ossKey: "uploads/csrf/x.m4a",
			}),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("missing_origin");
	});

	test("GET /api/recordings without Origin is still allowed (safe method)", async () => {
		const res = await fetch(`${BASE}/api/recordings`, { method: "GET" });
		expect(res.status).toBe(200);
	});
});
