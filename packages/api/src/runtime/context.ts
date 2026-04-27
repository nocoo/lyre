/**
 * RuntimeContext — the dependency bundle passed to every handler.
 *
 * Handlers in `packages/api/src/handlers/` receive a `RuntimeContext`
 * along with the parsed request inputs. They MUST NOT read host env
 * variables directly (that's `ctx.env`'s job) and MUST NOT import
 * framework modules (`hono/*`, etc.).
 *
 * The Hono worker constructs `RuntimeContext` from `c.env` plus the
 * Access JWT / Bearer token middleware that resolves the current user.
 */

import type { LyreEnv } from "./env";
import type { DbUser } from "../db/schema";
import type { LyreDb } from "../db/types";

export interface RuntimeContext {
  /** Env snapshot — see `runtime/env.ts`. */
  env: LyreEnv;
  /**
   * Drizzle DB handle for this request — a D1 handle injected by the
   * Cloudflare Worker entry via `openD1Db()`.
   */
  db: LyreDb;
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
