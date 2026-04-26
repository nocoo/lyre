import { Hono } from "hono";
import { searchHandler } from "@lyre/api/handlers/search";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const search = new Hono<{ Bindings: Bindings; Variables: Variables }>();

search.get("/", async (c) =>
  toResponse(c, await searchHandler(c.get("runtime"), c.req.query("q") ?? null)),
);
