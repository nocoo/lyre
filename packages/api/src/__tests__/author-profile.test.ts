import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTHOR_PROFILE_CACHE_TTL_MS,
	AUTHOR_PROFILE_URL,
	fetchAuthorProfile,
	hashEmail,
	normalizeEmail,
	parseAuthorProfile,
	resetAuthorProfileCache,
	shouldLookupAuthorProfile,
} from "../lib/author-profile";

const KNOWN_EMAIL = "architie@gmail.com";
const KNOWN_HASH = "7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217";
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

afterEach(() => {
	vi.useRealTimers();
});

describe("normalizeEmail / hashEmail", () => {
	it("trims, lowercases, and hashes without putting email on the wire", async () => {
		expect(normalizeEmail("  Architie@Gmail.com  ")).toBe(KNOWN_EMAIL);
		expect(await hashEmail(KNOWN_EMAIL)).toBe(KNOWN_HASH);
		expect(await hashEmail("  Architie@Gmail.com  ")).toBe(KNOWN_HASH);
		expect(await hashEmail("someone@example.com")).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("parseAuthorProfile", () => {
	it("keeps non-empty strings and drops everything else", () => {
		expect(parseAuthorProfile({ name: "Zheng Li", avatar: AVATAR, email: "secret" })).toEqual({
			name: "Zheng Li",
			avatar: AVATAR,
		});
		expect(parseAuthorProfile({ name: null, avatar: null })).toEqual({ name: null, avatar: null });
		expect(parseAuthorProfile({ name: "", avatar: "" })).toEqual({ name: null, avatar: null });
		expect(parseAuthorProfile({ name: 1, avatar: {} })).toEqual({ name: null, avatar: null });
		expect(parseAuthorProfile(["Zheng Li"])).toEqual({ name: null, avatar: null });
		expect(parseAuthorProfile(null)).toEqual({ name: null, avatar: null });
	});
});

describe("shouldLookupAuthorProfile", () => {
	it("runs in production and development, skips test and playwright", () => {
		expect(shouldLookupAuthorProfile({ NODE_ENV: "production" })).toBe(true);
		expect(shouldLookupAuthorProfile({ NODE_ENV: "development" })).toBe(true);
		expect(shouldLookupAuthorProfile({ NODE_ENV: "test" })).toBe(false);
		expect(shouldLookupAuthorProfile({ NODE_ENV: "production", PLAYWRIGHT: "1" })).toBe(false);
		expect(shouldLookupAuthorProfile({})).toBe(false);
	});
});

describe("fetchAuthorProfile", () => {
	it("GETs lizheng.blog with the hash and never the email", async () => {
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe(`${AUTHOR_PROFILE_URL}?hash=${KNOWN_HASH}`);
			expect(url).not.toContain("@");
			expect(url).not.toContain("architie");
			expect(JSON.stringify(init ?? {})).not.toContain(KNOWN_EMAIL);
			return jsonRes({ name: "Zheng Li", avatar: AVATAR, email: "secret@example.com" });
		});
		await expect(fetchAuthorProfile("  Architie@Gmail.com  ", fetcher)).resolves.toEqual({
			name: "Zheng Li",
			avatar: AVATAR,
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("returns empty on miss, 429, throw, and invalid json", async () => {
		await expect(
			fetchAuthorProfile(KNOWN_EMAIL, async () => jsonRes({ name: null, avatar: null })),
		).resolves.toEqual({ name: null, avatar: null });
		resetAuthorProfileCache();
		await expect(
			fetchAuthorProfile(KNOWN_EMAIL, async () => jsonRes({ name: null }, 429)),
		).resolves.toEqual({ name: null, avatar: null });
		resetAuthorProfileCache();
		await expect(
			fetchAuthorProfile(KNOWN_EMAIL, async () => {
				throw new Error("net");
			}),
		).resolves.toEqual({ name: null, avatar: null });
		resetAuthorProfileCache();
		await expect(
			fetchAuthorProfile(KNOWN_EMAIL, async () => new Response("{", { status: 200 })),
		).resolves.toEqual({ name: null, avatar: null });
	});

	it("does not cache a 429", async () => {
		let calls = 0;
		const fetcher = vi.fn(async () => {
			calls += 1;
			return jsonRes({ name: null }, 429);
		});
		await fetchAuthorProfile(KNOWN_EMAIL, fetcher);
		await fetchAuthorProfile(KNOWN_EMAIL, fetcher);
		expect(calls).toBe(2);
	});

	it("caches a 200 until TTL expires", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-21T00:00:00Z"));
		const fetcher = vi.fn(async () => jsonRes({ name: "Zheng Li", avatar: AVATAR }));
		await fetchAuthorProfile(KNOWN_EMAIL, fetcher);
		await fetchAuthorProfile(KNOWN_EMAIL, fetcher);
		expect(fetcher).toHaveBeenCalledTimes(1);

		vi.setSystemTime(new Date("2026-08-21T00:00:00Z").getTime() + AUTHOR_PROFILE_CACHE_TTL_MS + 1);
		await fetchAuthorProfile(KNOWN_EMAIL, fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
