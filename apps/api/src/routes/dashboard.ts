import { dashboardHandler } from "@lyre/api/handlers/dashboard";
import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";
import { toResponse } from "../lib/to-response";

export const dashboard = new Hono<{
	Bindings: Bindings;
	Variables: Variables;
}>();

dashboard.get("/", async (c) => toResponse(c, await dashboardHandler(c.get("runtime"))));
