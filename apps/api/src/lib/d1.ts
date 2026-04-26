/**
 * Open a Drizzle handle bound to the given D1 binding.
 *
 * Mirrors `@lyre/api/src/db/drivers/d1.ts` but lives in the worker
 * package so we can use a static `import` (the in-package version uses
 * `require()` to keep `@lyre/api` runnable on Bun without pulling
 * `drizzle-orm/d1` as a hard dep).
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "@lyre/api/db/schema";
import type { LyreDb } from "@lyre/api/db";

export function openD1(binding: D1Database): LyreDb {
  // The drizzle/d1 driver returns a fully Promise-based handle that
  // matches the `LyreDb` shape used by all Wave C.0 repos.
  return drizzle(binding, { schema }) as unknown as LyreDb;
}
