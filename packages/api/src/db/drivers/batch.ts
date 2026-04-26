/**
 * Driver-agnostic batched-write helper.
 *
 * D1 has **no interactive transactions** — the supported pattern is
 * `await db.batch([stmt1, stmt2, ...])`, which queues prepared statements
 * and ships them as a single atomic request.
 *
 * bun:sqlite / better-sqlite3 do support synchronous `db.transaction(cb)`,
 * which is the closest equivalent.
 *
 * `runBatch(db, build)` lets repos express "execute this list of writes
 * atomically" once and have it work on both. The `build` callback receives
 * the handle to bind statements to (`tx` for sqlite; `db` itself for D1)
 * and returns the prepared drizzle queries.
 */

import type { LyreDb } from "../types";

interface BatchableDb {
  batch?: (statements: unknown[]) => Promise<unknown>;
  transaction?: (cb: (tx: LyreDb) => unknown) => unknown;
}

interface RunnableQuery {
  run: () => unknown;
}

export async function runBatch(
  db: LyreDb,
  build: (handle: LyreDb) => RunnableQuery[],
): Promise<void> {
  const handle = db as BatchableDb;
  if (typeof handle.batch === "function") {
    // Cloudflare D1: ship queued statements as one atomic request.
    const stmts = build(db);
    await handle.batch(stmts as unknown[]);
    return;
  }
  if (typeof handle.transaction === "function") {
    // bun:sqlite / better-sqlite3: synchronous transaction.
    handle.transaction((tx: LyreDb) => {
      const stmts = build(tx);
      for (const s of stmts) s.run();
    });
    return;
  }
  // Last-resort fallback — execute sequentially without atomicity.
  const stmts = build(db);
  for (const s of stmts) await s.run();
}
