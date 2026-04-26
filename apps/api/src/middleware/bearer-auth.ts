/**
 * Bearer-token auth middleware.
 *
 * Reads `Authorization: Bearer <token>`, hashes it, looks up the
 * `device_tokens` table via `@lyre/api`, and populates
 * `runtime.user` on success. On failure (no header, missing token,
 * unknown hash) the middleware is a NO-OP — it does NOT 401. That's
 * `access-auth`'s job, so the two compose cleanly.
 */

import type { MiddlewareHandler } from "hono";
import { hashToken } from "@lyre/api/lib/api-auth";
import {
  makeUsersRepo,
  makeDeviceTokensRepo,
} from "@lyre/api/db/repositories";
import type { Bindings, Variables } from "../bindings";

export function bearerAuth(): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> {
  return async (c, next) => {
    const runtime = c.get("runtime");
    const auth = c.req.header("Authorization");
    if (auth?.startsWith("Bearer ")) {
      const raw = auth.slice(7);
      if (raw) {
        const hash = hashToken(raw);
        const deviceTokens = makeDeviceTokensRepo(runtime.db);
        const tok = await deviceTokens.findByHash(hash);
        if (tok) {
          // Fire-and-forget last-used touch.
          void deviceTokens.touchLastUsed(tok.id);
          const users = makeUsersRepo(runtime.db);
          runtime.user = (await users.findById(tok.userId)) ?? null;
        }
      }
    }
    await next();
  };
}
