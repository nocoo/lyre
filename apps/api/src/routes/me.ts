import { meHandler } from "@lyre/api/handlers/me";
import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";
import { toResponse } from "../lib/to-response";

export const me = new Hono<{ Bindings: Bindings; Variables: Variables }>();

me.get("/", async (c) => toResponse(c, await meHandler(c.get("runtime"))));
