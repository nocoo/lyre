import { beforeEach, describe, expect, it, vi } from "vitest";
import { meHandler } from "../../handlers/me";
import { resetAuthorProfileCache } from "../../lib/author-profile";
import { makeCtx, setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

const AVATAR = "https://example.com/avatar-80.jpg";

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	resetAuthorProfileCache();
});

describe("meHandler", () => {
	it("returns 401 for anonymous", async () => {
		const res = await meHandler(setupAnonCtx());
		expect(res.status).toBe(401);
	});

	it("returns Access identity without lookup in test env", async () => {
		const { ctx, user } = await setupAuthedCtx();
		const fetcher = vi.fn(async () => jsonRes({ name: "Zheng Li", avatar: AVATAR }));
		const res = await meHandler(ctx, fetcher);
		expect(res.status).toBe(200);
		if (res.kind !== "json") throw new Error();
		expect(res.body).toEqual({
			email: user.email,
			name: user.name,
			avatarUrl: null,
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("fills name and avatar from lizheng.blog in production", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: { NODE_ENV: "production" } });
		const fetcher = vi.fn(async (url: string) => {
			expect(url).not.toContain(user.email);
			expect(url).not.toContain("@");
			return jsonRes({ name: "Zheng Li", avatar: AVATAR });
		});
		const res = await meHandler(ctx, fetcher);
		expect(res.status).toBe(200);
		if (res.kind !== "json") throw new Error();
		expect(res.body).toEqual({
			email: user.email,
			name: "Zheng Li",
			avatarUrl: AVATAR,
		});
	});

	it("falls back to Access identity when the profile is empty or fetch fails", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: { NODE_ENV: "production" } });
		const empty = await meHandler(ctx, async () => jsonRes({ name: null, avatar: null }));
		if (empty.kind !== "json") throw new Error();
		expect(empty.body).toEqual({
			email: user.email,
			name: user.name,
			avatarUrl: null,
		});

		resetAuthorProfileCache();
		const failed = await meHandler(ctx, async () => {
			throw new Error("offline");
		});
		if (failed.kind !== "json") throw new Error();
		expect(failed.body).toEqual({
			email: user.email,
			name: user.name,
			avatarUrl: null,
		});
	});

	it("skips lookup when PLAYWRIGHT=1", async () => {
		const { user } = await setupAuthedCtx();
		const ctx = makeCtx(user, { env: { NODE_ENV: "production", PLAYWRIGHT: "1" } });
		const fetcher = vi.fn(async () => jsonRes({ name: "Zheng Li", avatar: AVATAR }));
		const res = await meHandler(ctx, fetcher);
		if (res.kind !== "json") throw new Error();
		expect(res.body).toEqual({
			email: user.email,
			name: user.name,
			avatarUrl: null,
		});
		expect(fetcher).not.toHaveBeenCalled();
	});
});
