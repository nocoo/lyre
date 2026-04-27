/**
 * Auth utilities for the API package.
 *
 * The Worker resolves the current user in middleware
 * (`apps/api/src/middleware/{bearer-auth,access-auth}.ts`) and injects
 * it into `RuntimeContext.user`. Handlers consume `ctx.user` directly.
 *
 * Only the token hashing helper lives here — it is shared between the
 * bearer-auth middleware and the device-tokens handler.
 */

import { createHash } from "crypto";

/** SHA-256 hash a raw token string to hex. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
