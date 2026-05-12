import { Hono } from "hono";
import {
  getAsrSettingsHandler,
  updateAsrSettingsHandler,
} from "@lyre/api/handlers/settings-asr";
import { toResponse } from "../../lib/to-response";
import type { Bindings, Variables } from "../../bindings";

export const settingsAsr = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

settingsAsr.get("/", async (c) =>
  toResponse(c, await getAsrSettingsHandler(c.get("runtime"))),
);

settingsAsr.put("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, await updateAsrSettingsHandler(c.get("runtime"), body));
});
