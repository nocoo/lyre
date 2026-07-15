import { getAsrSettingsHandler, updateAsrSettingsHandler } from "@lyre/api/handlers/settings-asr";
import { Hono } from "hono";
import type { Bindings, Variables } from "../../bindings";
import { toResponse } from "../../lib/to-response";

export const settingsAsr = new Hono<{
	Bindings: Bindings;
	Variables: Variables;
}>();

settingsAsr.get("/", async (c) => toResponse(c, await getAsrSettingsHandler(c.get("runtime"))));

settingsAsr.put("/", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await updateAsrSettingsHandler(c.get("runtime"), body));
});
