/**
 * RuntimeContext — the dependency bundle passed to every handler.
 *
 * Handlers in `packages/api/src/handlers/` receive a `RuntimeContext`
 * along with the parsed request inputs. They MUST NOT read host env
 * variables directly (that's `ctx.env`'s job) and MUST NOT import
 * framework modules (`next/*`, `hono/*`, etc.).
 *
 * The legacy Next.js adapter constructs a `RuntimeContext` per request
 * by snapshotting `loadEnvFromProcess()` and resolving the user via
 * `getCurrentUser`. The new Hono worker constructs it from `c.env`
 * + Access JWT / Bearer token middleware.
 */

import type { LyreEnv } from "./env";
import type { DbUser } from "../db/schema";

export interface RuntimeContext {
  /** Env snapshot — see `runtime/env.ts`. */
  env: LyreEnv;
  /**
   * Current authenticated user, or `null` when the route allows
   * anonymous access (e.g. `/api/live`).
   */
  user: DbUser | null;
  /**
   * The original request headers — handlers occasionally need them
   * (e.g. to read `X-Webhook-Key` on the Backy pull endpoint).
   */
  headers: Headers;
}
