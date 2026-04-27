/**
 * Database type re-exports.
 *
 * The Worker holds the live D1 binding on `RuntimeContext.db`; tests
 * use an in-memory `bun:sqlite` Drizzle handle. There is no global
 * singleton — every repo is constructed via `makeRepos(db)`.
 */

export type { LyreDb } from "./types";
