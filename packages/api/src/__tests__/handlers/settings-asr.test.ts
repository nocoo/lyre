import { describe, expect, it } from "vitest";
import { getAsrSettingsHandler, updateAsrSettingsHandler } from "../../handlers/settings-asr";
import { setupAnonCtx, setupAuthedCtx, testRepos } from "../_fixtures/runtime-context";

describe("settings-asr handlers", () => {
	it("401 anon", async () => {
		expect((await getAsrSettingsHandler(setupAnonCtx())).status).toBe(401);
		expect((await updateAsrSettingsHandler(setupAnonCtx(), {})).status).toBe(401);
	});

	it("get returns default model when nothing stored", async () => {
		const { ctx } = await setupAuthedCtx();
		const res = await getAsrSettingsHandler(ctx);
		expect(res.status).toBe(200);
		if (res.kind !== "json") throw new Error();
		expect((res.body as { model: string }).model).toBe("qwen3-asr-flash-filetrans");
	});

	it("get falls back to default for invalid stored value", async () => {
		const { ctx, user } = await setupAuthedCtx();
		await testRepos().settings.upsert(user.id, "asr.model", "garbage-model");
		const res = await getAsrSettingsHandler(ctx);
		expect(res.status).toBe(200);
		if (res.kind !== "json") throw new Error();
		expect((res.body as { model: string }).model).toBe("qwen3-asr-flash-filetrans");
	});

	it("put 400 on invalid model", async () => {
		const { ctx } = await setupAuthedCtx();
		const res = await updateAsrSettingsHandler(ctx, { model: "bogus" });
		expect(res.status).toBe(400);
	});

	it("put saves valid model and returns updated value", async () => {
		const { ctx } = await setupAuthedCtx();
		const res = await updateAsrSettingsHandler(ctx, {
			model: "qwen3-asr-flash-filetrans-2025-11-17",
		});
		expect(res.status).toBe(200);
		if (res.kind !== "json") throw new Error();
		expect((res.body as { model: string }).model).toBe("qwen3-asr-flash-filetrans-2025-11-17");
	});

	it("put with empty body returns current settings", async () => {
		const { ctx } = await setupAuthedCtx();
		const res = await updateAsrSettingsHandler(ctx, {});
		expect(res.status).toBe(200);
		if (res.kind !== "json") throw new Error();
		expect((res.body as { model: string }).model).toBe("qwen3-asr-flash-filetrans");
	});
});
