import { Hono } from "hono";
import {
  getBackySettingsHandler,
  updateBackySettingsHandler,
  testBackySettingsHandler,
  backyHistoryHandler,
  generatePullKeyHandler,
  deletePullKeyHandler,
  backyPullHeadHandler,
  backyPullPostHandler,
} from "@lyre/api/handlers/settings-backy";
import { toResponse } from "../../lib/to-response";
import type { Bindings, Variables } from "../../bindings";

export const settingsBacky = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

settingsBacky.get("/", async (c) =>
  toResponse(c, await getBackySettingsHandler(c.get("runtime"))),
);

settingsBacky.put("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, await updateBackySettingsHandler(c.get("runtime"), body));
});

settingsBacky.post("/test", async (c) =>
  toResponse(c, await testBackySettingsHandler(c.get("runtime"))),
);

settingsBacky.get("/history", async (c) =>
  toResponse(c, await backyHistoryHandler(c.get("runtime"))),
);

settingsBacky.post("/pull-key", async (c) =>
  toResponse(c, await generatePullKeyHandler(c.get("runtime"))),
);

settingsBacky.delete("/pull-key", async (c) =>
  toResponse(c, await deletePullKeyHandler(c.get("runtime"))),
);

// HEAD + POST share `/pull`; Hono's `.on(["HEAD"], ...)` does not survive
// `app.route()` mounting (HEAD is normally derived from GET), so dispatch
// by method inside a single `.all()` handler.
settingsBacky.all("/pull", async (c) => {
  const method = c.req.method;
  if (method === "HEAD") {
    return toResponse(c, await backyPullHeadHandler(c.get("runtime")));
  }
  if (method === "POST") {
    return toResponse(c, await backyPullPostHandler(c.get("runtime")));
  }
  return c.json({ error: "Method not allowed" }, 405);
});
