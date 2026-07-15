import { ossCleanupHandler, ossScanHandler } from "@lyre/api/handlers/settings-oss";
import { Hono } from "hono";
import type { Bindings, Variables } from "../../bindings";
import { toResponse } from "../../lib/to-response";

export const settingsOss = new Hono<{
	Bindings: Bindings;
	Variables: Variables;
}>();

settingsOss.post("/scan", async (c) => toResponse(c, await ossScanHandler(c.get("runtime"))));

settingsOss.post("/cleanup", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await ossCleanupHandler(c.get("runtime"), body));
});
