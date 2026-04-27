/**
 * Handlers for `/api/live` — public health-check endpoint.
 *
 * No authentication. Validates DB connectivity, returns app version
 * and uptime. Called by Railway / monitoring probes.
 */

import { sql } from "drizzle-orm";
import { APP_VERSION } from "../lib/version";
import { json, type HandlerResponse } from "./http";

/** Strip the word "ok" from error messages so keyword monitors don't false-positive. */
function sanitize(msg: string): string {
  return msg.replace(/\bok\b/gi, "***");
}

/**
 * Default DB probe — lazy-loads the legacy sqlite singleton so worker
 * bundles don't drag `bun:sqlite` / `better-sqlite3` in. Worker callers
 * always pass an explicit probe and never hit this branch.
 */
function defaultProbe(): void {
  const path = "../" + "db";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
  const g = globalThis as any;
  const req: (id: string) => unknown =
    typeof g.require === "function"
      ? g.require
      : // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require("mo" + "dule") as { createRequire: (u: string) => (id: string) => unknown }).createRequire(import.meta.url);
  const { db } = req(path) as typeof import("../db");
  db.run(sql`SELECT 1 AS probe`);
}

/**
 * Check DB connectivity and return liveness JSON.
 * `probeDb` is injected for testability; defaults to a `SELECT 1`.
 */
export function liveHandler(
  probeDb: () => void = defaultProbe,
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
