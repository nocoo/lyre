import { Hono } from "hono";
import { dashboardHandler } from "@lyre/api/handlers/dashboard";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const dashboard = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

dashboard.get("/", async (c) =>
  toResponse(c, await dashboardHandler(c.get("runtime"))),
);
