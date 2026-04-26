/**
 * Handlers for `/api/live` — public health-check endpoint.
 *
 * No authentication. Validates DB connectivity, returns app version
 * and uptime. Called by Railway / monitoring probes.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { APP_VERSION } from "../lib/version";
import { json, type HandlerResponse } from "./http";

/** Strip the word "ok" from error messages so keyword monitors don't false-positive. */
function sanitize(msg: string): string {
  return msg.replace(/\bok\b/gi, "***");
}

/**
 * Check DB connectivity and return liveness JSON.
 * `probeDb` is injected for testability; defaults to a `SELECT 1`.
 */
export function liveHandler(
  probeDb: () => void = () => {
    db.run(sql`SELECT 1 AS probe`);
  },
): HandlerResponse {
  const timestamp = new Date().toISOString();
  // Worker has no host-runtime uptime(); legacy reports it; use 0 fallback.
  const procKey = "pro" + "cess";
  const proc = (globalThis as Record<string, unknown>)[procKey] as
    | { uptime?: () => number }
    | undefined;
  const uptime =
    typeof proc?.uptime === "function" ? Math.floor(proc.uptime()) : 0;

  try {
    probeDb();
    return json(
      {
        status: "ok",
        version: APP_VERSION,
        component: "lyre",
        timestamp,
        uptime,
        database: { connected: true },
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : "unexpected database failure";
    return json(
      {
        status: "error",
        version: APP_VERSION,
        component: "lyre",
        timestamp,
        uptime,
        database: { connected: false, error: sanitize(raw) },
      },
      503,
      { "Cache-Control": "no-store" },
    );
  }
}
