import { Hono } from "hono";
import {
  ossScanHandler,
  ossCleanupHandler,
} from "@lyre/api/handlers/settings-oss";
import { toResponse } from "../../lib/to-response";
import type { Bindings, Variables } from "../../bindings";

export const settingsOss = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

settingsOss.post("/scan", async (c) =>
  toResponse(c, await ossScanHandler(c.get("runtime"))),
);

settingsOss.post("/cleanup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, await ossCleanupHandler(c.get("runtime"), body));
});
