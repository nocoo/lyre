import { describe, expect, test } from "bun:test";
import { get } from "./helpers";

describe("search endpoint", () => {
	test("GET /api/search returns 200", async () => {
		const res = await get("/api/search?q=test");
		expect(res.status).toBe(200);
	});
});

describe("dashboard endpoint", () => {
	test("GET /api/dashboard returns 200 with empty OSS stats when unconfigured", async () => {
		const res = await get("/api/dashboard");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			recordings: { totalCount: number };
			oss: { total: { files: number; size: number } };
		};
		expect(body.recordings).toBeDefined();
		expect(body.oss.total.files).toBe(0);
		expect(body.oss.total.size).toBe(0);
	});
});
