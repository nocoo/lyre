/**
 * Driver-agnostic helpers for normalizing the shape of `.run()` results.
 *
 * `bun:sqlite` and `better-sqlite3` (drizzle-orm/bun-sqlite, /better-sqlite3)
 * return `{ changes: number, lastInsertRowid: ... }` directly. Cloudflare D1
 * (drizzle-orm/d1) returns `{ success, meta: { changes, ... } }`. Repos call
 * `rowsAffected(result)` once and stop caring about the dialect.
 */

export interface SqliteRunResult {
  changes?: number;
  lastInsertRowid?: number | bigint;
}

export interface D1RunResult {
  success?: boolean;
  meta?: {
    changes?: number;
    duration?: number;
    last_row_id?: number;
  };
}

export type AnyRunResult = SqliteRunResult | D1RunResult | unknown;

/**
 * Number of rows affected by a write operation, regardless of which driver
 * produced the result. Returns 0 for any unrecognized shape.
 */
export function rowsAffected(result: AnyRunResult): number {
  if (!result || typeof result !== "object") return 0;
  const r = result as SqliteRunResult & D1RunResult;
  if (typeof r.changes === "number") return r.changes;
  if (r.meta && typeof r.meta.changes === "number") return r.meta.changes;
  return 0;
}
