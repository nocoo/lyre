/**
 * `LyreDb` — the Drizzle handle type used across all repositories.
 *
 * Currently aliased to `any` because the union (BunSQLiteDatabase |
 * BetterSQLite3Database | DrizzleD1Database) over Drizzle's generics is
 * impractical to spell here without dragging the heavy generic types into
 * every repo signature. Tightening this when D1 lands in Wave C is
 * tracked in docs/03-cf-worker-migration-plan.md (Wave B.6).
 *
 * The point of this type is *not* compile-time safety today — it's making
 * the injection seam explicit so handlers stop reaching for the global
 * singleton. Once we have a real D1 binding to test against we can swap
 * this to a structural interface that all three drivers conform to.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LyreDb = any;
