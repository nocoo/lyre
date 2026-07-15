/**
 * `LyreDb` — the Drizzle handle type used across all repositories.
 *
 * Aliased to `any` because the union (DrizzleD1Database | BunSQLiteDatabase
 * for tests) over Drizzle's generics is impractical to spell without
 * dragging heavy generics into every repo signature. `BaseSQLiteDatabase`
 * as a shared ancestor was tried but breaks `.insert().values()` overload
 * inference in `services/backup.ts`, forcing every call site into casts.
 *
 * The point of this type is making the injection seam explicit so handlers
 * never reach for a global singleton.
 */

// biome-ignore lint/suspicious/noExplicitAny: intentional escape hatch — see doc comment above
export type LyreDb = any;
