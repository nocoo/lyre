import { searchHandler } from "@lyre/api/handlers/search";
import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";
import { toResponse } from "../lib/to-response";

export const search = new Hono<{ Bindings: Bindings; Variables: Variables }>();

search.get("/", async (c) =>
	toResponse(c, await searchHandler(c.get("runtime"), c.req.query("q") ?? null)),
);
