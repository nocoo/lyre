import {
	exportBackupHandler,
	importBackupHandler,
	pushBackupHandler,
} from "@lyre/api/handlers/settings-backup";
import { Hono } from "hono";
import type { Bindings, Variables } from "../../bindings";
import { toResponse } from "../../lib/to-response";

export const settingsBackup = new Hono<{
	Bindings: Bindings;
	Variables: Variables;
}>();

settingsBackup.get("/export", async (c) =>
	toResponse(c, await exportBackupHandler(c.get("runtime"))),
);

settingsBackup.post("/import", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await importBackupHandler(c.get("runtime"), body));
});

settingsBackup.post("/push", async (c) => toResponse(c, await pushBackupHandler(c.get("runtime"))));
