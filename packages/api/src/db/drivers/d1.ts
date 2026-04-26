/**
 * Cloudflare D1 driver.
 *
 * Stub for Wave C — the worker entry point will call `openD1Db(env.DB)` once
 * per request (or once per Worker isolate, depending on benchmarks). D1
 * schema migration runs out-of-band via wrangler — D1 has no `:memory:` and
 * no PRAGMAs, so the SQLite bootstrap SQL doesn't apply here.
 *
 * Intentionally not used in legacy. Wave C wires this in.
 */

import * as schema from "../schema";
import type { LyreDb } from "../types";

// Minimal shape of a Cloudflare D1Database binding — we don't import
// @cloudflare/workers-types in @lyre/api so we redeclare the few methods
// drizzle-orm/d1 uses.
export interface D1DatabaseLike {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown>;
  exec(query: string): Promise<unknown>;
}

export function openD1Db(binding: D1DatabaseLike): LyreDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/d1");
  return drizzle(binding, { schema });
}
