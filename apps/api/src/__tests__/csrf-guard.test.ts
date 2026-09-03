/**
 * Tests for the CSRF / same-origin guard middleware.
 *
 * The middleware sits ahead of any handler logic, so we mount it on a
 * minimal Hono app with a catch-all route that returns 200 — every
 * non-200 response in these tests originates from the guard itself.
 *
 * Hono's `app.request(url, init, env)` takes a third arg that becomes
 * `c.env`, mirroring how Cloudflare Workers binds vars in production.
 */

import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { Bindings, Variables } from "../bindings";
import { csrfGuard } from "../middleware/csrf-guard";

function buildGuardedApp() {
	const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
	app.use("/api/*", csrfGuard());
	app.all("/api/*", (c) => c.json({ ok: true }));
	return app;
}

const SELF = "https://lyre.hexly.ai";
const NO_ENV = {} as Bindings;

describe("csrfGuard — safe methods bypass the check", () => {
	test.each(["GET", "HEAD", "OPTIONS"])(
		"%s never gets blocked even without Origin",
		async (method) => {
			const app = buildGuardedApp();
			const res = await app.request(`${SELF}/api/folders`, { method }, NO_ENV);
			expect(res.status).toBe(200);
		},
	);
});

describe("csrfGuard — unsafe methods require same-origin", () => {
	test("POST with matching Origin is allowed", async () => {
		const app = buildGuardedApp();
		const res = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: { Origin: SELF, "content-type": "application/json" },
				body: "{}",
			},
			NO_ENV,
		);
		expect(res.status).toBe(200);
	});

	test.each(["POST", "PUT", "PATCH", "DELETE"])(
		"%s with cross-origin Origin is rejected with 403",
		async (method) => {
			const app = buildGuardedApp();
			const res = await app.request(
				`${SELF}/api/folders`,
				{
					method,
					headers: {
						Origin: "https://evil.example",
						"content-type": "application/json",
					},
					body: "{}",
				},
				NO_ENV,
			);
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: "forbidden_origin" });
		},
	);

	test("POST with no Origin and no Referer is rejected", async () => {
		const app = buildGuardedApp();
		const res = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			},
			NO_ENV,
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "missing_origin" });
	});

	test("POST falls back to Referer when Origin is absent", async () => {
		const app = buildGuardedApp();
		const okRes = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: {
					Referer: `${SELF}/some/path`,
					"content-type": "application/json",
				},
				body: "{}",
			},
			NO_ENV,
		);
		expect(okRes.status).toBe(200);

		const badRes = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: {
					Referer: "https://evil.example/x",
					"content-type": "application/json",
				},
				body: "{}",
			},
			NO_ENV,
		);
		expect(badRes.status).toBe(403);
		expect(await badRes.json()).toEqual({ error: "forbidden_origin" });
	});

	test("malformed Origin header is treated as missing → 403", async () => {
		const app = buildGuardedApp();
		const res = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: { Origin: "not-a-url", "content-type": "application/json" },
				body: "{}",
			},
			NO_ENV,
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "missing_origin" });
	});

	test("PUBLIC_ORIGIN allow-list adds an extra trusted origin", async () => {
		const app = buildGuardedApp();
		const env = {
			PUBLIC_ORIGIN: "https://preview.lyre.hexly.ai, https://staging.lyre.hexly.ai",
		} as Bindings;
		const okRes = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: {
					Origin: "https://preview.lyre.hexly.ai",
					"content-type": "application/json",
				},
				body: "{}",
			},
			env,
		);
		expect(okRes.status).toBe(200);

		const stillBlocked = await app.request(
			`${SELF}/api/folders`,
			{
				method: "POST",
				headers: {
					Origin: "https://evil.example",
					"content-type": "application/json",
				},
				body: "{}",
			},
			env,
		);
		expect(stillBlocked.status).toBe(403);
	});
});

describe("csrfGuard — bearer-token clients are exempt", () => {
	test.each(["POST", "PUT", "PATCH", "DELETE"])(
		"%s with Authorization: Bearer skips the Origin check entirely",
		async (method) => {
			const app = buildGuardedApp();
			// No Origin, cross-origin Referer — still allowed because of Bearer.
			const res = await app.request(
				`${SELF}/api/recordings`,
				{
					method,
					headers: {
						Authorization: "Bearer device-abc",
						Referer: "https://evil.example/x",
						"content-type": "application/json",
					},
					body: "{}",
				},
				NO_ENV,
			);
			expect(res.status).toBe(200);
		},
	);

	test("non-Bearer Authorization header is NOT exempt", async () => {
		const app = buildGuardedApp();
		const res = await app.request(
			`${SELF}/api/recordings`,
			{
				method: "POST",
				headers: {
					Authorization: "Basic xyz",
					Origin: "https://evil.example",
					"content-type": "application/json",
				},
				body: "{}",
			},
			NO_ENV,
		);
		expect(res.status).toBe(403);
	});
});

describe("csrfGuard — documented machine-to-machine endpoints are exempt", () => {
	test("POST /api/backy/pull is allowed without Origin (remote Backy webhook)", async () => {
		const app = buildGuardedApp();
		const res = await app.request(
			`${SELF}/api/backy/pull`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			},
			NO_ENV,
		);
		expect(res.status).toBe(200);
	});

	test("a path that merely looks similar is NOT exempt", async () => {
		const app = buildGuardedApp();
		const res = await app.request(
			`${SELF}/api/backy/pull/extra`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			},
			NO_ENV,
		);
		expect(res.status).toBe(403);
	});
});
