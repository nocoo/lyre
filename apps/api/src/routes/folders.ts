import {
	createFolderHandler,
	deleteFolderHandler,
	getFolderHandler,
	listFoldersHandler,
	updateFolderHandler,
} from "@lyre/api/handlers/folders";
import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";
import { toResponse } from "../lib/to-response";

export const folders = new Hono<{ Bindings: Bindings; Variables: Variables }>();

folders.get("/", async (c) => toResponse(c, await listFoldersHandler(c.get("runtime"))));

folders.post("/", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await createFolderHandler(c.get("runtime"), body));
});

folders.get("/:id", async (c) =>
	toResponse(c, await getFolderHandler(c.get("runtime"), c.req.param("id"))),
);

folders.put("/:id", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await updateFolderHandler(c.get("runtime"), c.req.param("id"), body));
});

folders.delete("/:id", async (c) =>
	toResponse(c, await deleteFolderHandler(c.get("runtime"), c.req.param("id"))),
);
