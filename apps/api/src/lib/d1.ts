/**
 * Open a Drizzle handle bound to the given D1 binding.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "@lyre/api/db/schema";
import type { LyreDb } from "@lyre/api/db";

export function openD1(binding: D1Database): LyreDb {
  return drizzle(binding, { schema }) as unknown as LyreDb;
}
