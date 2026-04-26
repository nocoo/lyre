import { Hono } from "hono";
import { liveHandler } from "@lyre/api/handlers/live";
import { sql } from "drizzle-orm";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const live = new Hono<{ Bindings: Bindings; Variables: Variables }>();

live.get("/", async (c) => {
  const runtime = c.get("runtime");
  // Inject a D1-flavoured probe so the handler doesn't reach for the
  // legacy SQLite singleton.
  const probe = async () => {
    await runtime.db.run(sql`SELECT 1 AS probe`);
  };
  // liveHandler is sync but accepts a probe fn — wrap with await-by-throw.
  // The handler swallows thrown errors and returns 503, so a rejected
  // promise from probe() needs to be converted to a sync throw.
  // Easiest: pre-run the probe ourselves and pass either a no-op or a
  // throwing closure to liveHandler.
  let probeError: unknown = null;
  try {
    await probe();
  } catch (e) {
    probeError = e;
  }
  const result = liveHandler(() => {
    if (probeError) throw probeError;
  });
  return toResponse(c, result);
});
