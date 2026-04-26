import { Hono } from "hono";
import {
  listTokensHandler,
  createTokenHandler,
  deleteTokenHandler,
} from "@lyre/api/handlers/settings-tokens";
import { toResponse } from "../../lib/to-response";
import type { Bindings, Variables } from "../../bindings";

export const settingsTokens = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

settingsTokens.get("/", async (c) =>
  toResponse(c, await listTokensHandler(c.get("runtime"))),
);

settingsTokens.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, await createTokenHandler(c.get("runtime"), body));
});

settingsTokens.delete("/:id", async (c) =>
  toResponse(c, await deleteTokenHandler(c.get("runtime"), c.req.param("id"))),
);
