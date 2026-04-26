/**
 * Public Backy webhook routes mounted at `/api/backy/*`.
 *
 * Distinct from `/api/settings/backy/*` (the user-facing config UI):
 * these endpoints are machine-to-machine (no Access JWT), authenticated
 * by the per-user pull-key inside the handler. The URL is the one shown
 * in Settings → Backy and pasted into the remote Backy instance, so it
 * has to live at `/api/backy/pull`.
 *
 * Note: HEAD + POST share `/pull` because remote Backy probes with HEAD
 * before issuing POST. Hono's `.on(["HEAD"], ...)` does not survive
 * `app.route()` mounting (HEAD is normally derived from GET), so we
 * dispatch by method inside a single `all()` handler.
 */

import { Hono } from "hono";
import {
  backyPullHeadHandler,
  backyPullPostHandler,
} from "@lyre/api/handlers/settings-backy";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const backy = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

backy.all("/pull", async (c) => {
  const method = c.req.method;
  if (method === "HEAD") {
    return toResponse(c, await backyPullHeadHandler(c.get("runtime")));
  }
  if (method === "POST") {
    return toResponse(c, await backyPullPostHandler(c.get("runtime")));
  }
  return c.json({ error: "Method not allowed" }, 405);
});
