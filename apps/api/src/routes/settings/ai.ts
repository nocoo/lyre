import {
	getAiSettingsHandler,
	testAiSettingsHandler,
	updateAiSettingsHandler,
} from "@lyre/api/handlers/settings-ai";
import { Hono } from "hono";
import type { Bindings, Variables } from "../../bindings";
import { toResponse } from "../../lib/to-response";

export const settingsAi = new Hono<{
	Bindings: Bindings;
	Variables: Variables;
}>();

settingsAi.get("/", async (c) => toResponse(c, await getAiSettingsHandler(c.get("runtime"))));

settingsAi.put("/", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await updateAiSettingsHandler(c.get("runtime"), body));
});

settingsAi.post("/test", async (c) => toResponse(c, await testAiSettingsHandler(c.get("runtime"))));
