/**
 * Constructs a `RuntimeContext` per request and stashes it on
 * `c.var.runtime` for downstream middleware + route handlers.
 *
 * `user` starts as `null` here; it's populated by `bearer-auth` and/or
 * `access-auth` middleware that runs after this one.
 */

import type { MiddlewareHandler } from "hono";
import { openD1 } from "../lib/d1";
import { buildLyreEnv } from "../lib/env";
import type { Bindings, Variables } from "../bindings";

export function runtimeContext(): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> {
  return async (c, next) => {
    const env = buildLyreEnv(c.env);
    const db = openD1(c.env.DB);
    c.set("runtime", {
      env,
      db,
      user: null,
      headers: c.req.raw.headers,
    });
    await next();
  };
}
