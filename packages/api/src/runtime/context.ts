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
import type { LyreDb } from "../db/types";

export interface RuntimeContext {
  /** Env snapshot — see `runtime/env.ts`. */
  env: LyreEnv;
  /**
   * Drizzle DB handle for this request.
   *
   * Wave B.6: handlers should read/write through `ctx.db` (and the per-db
   * repo factory in `db/repositories`) rather than the legacy global
   * singleton. The legacy adapter injects the SQLite singleton; the
   * Cloudflare Worker entry will inject a D1 handle via `openD1Db()`.
   *
   * Optional during the B.6.b migration; will become required once all
   * handlers are off `import { db }`.
   */
  db?: LyreDb;
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
