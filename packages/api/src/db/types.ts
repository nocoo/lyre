/**
 * `LyreDb` — the Drizzle handle type used across all repositories.
 *
 * Aliased to `any` because the union (DrizzleD1Database | BunSQLiteDatabase
 * for tests) over Drizzle's generics is impractical to spell without
 * dragging heavy generics into every repo signature.
 *
 * The point of this type is making the injection seam explicit so handlers
 * never reach for a global singleton.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LyreDb = any;
