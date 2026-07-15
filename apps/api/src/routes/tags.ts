import {
	createTagHandler,
	deleteTagHandler,
	listTagsHandler,
	updateTagHandler,
} from "@lyre/api/handlers/tags";
import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";
import { toResponse } from "../lib/to-response";

export const tags = new Hono<{ Bindings: Bindings; Variables: Variables }>();

tags.get("/", async (c) => toResponse(c, await listTagsHandler(c.get("runtime"))));

tags.post("/", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await createTagHandler(c.get("runtime"), body));
});

tags.put("/:id", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	return toResponse(c, await updateTagHandler(c.get("runtime"), c.req.param("id"), body));
});

tags.delete("/:id", async (c) =>
	toResponse(c, await deleteTagHandler(c.get("runtime"), c.req.param("id"))),
);
