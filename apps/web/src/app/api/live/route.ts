import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { db } from "@/db/index";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Lightweight liveness / health-check endpoint.
 *
 * - No authentication required
 * - No caching (force-dynamic + Cache-Control: no-store)
 * - Validates core dependency connectivity (database)
 * - Returns system metadata (version, uptime, timestamp)
 *
 * Error responses intentionally avoid the word "ok" so that
 * keyword-based monitors do not produce false positives.
 */
export function GET() {
  return checkHealth(() => {
    // Lightweight probe: SELECT with LIMIT 1 — validates connectivity & schema
    db.select().from(users).limit(1).all();
  });
}

/**
 * Core health-check logic, extracted for testability.
 *
 * @param probeDb — callback that validates database connectivity.
 *                  Throwing indicates the database is unreachable.
 */
export function checkHealth(probeDb: () => void) {
  const timestamp = Date.now();
  const uptime = Math.round(process.uptime());

  try {
    probeDb();

    return respond({
      status: "ok",
      version: APP_VERSION,
      timestamp,
      uptime,
      db: { connected: true },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unexpected database failure";
    return error(`database unreachable: ${message}`, timestamp);
  }
}

// ── Helpers ──

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function error(reason: string, timestamp: number) {
  return respond(
    {
      status: "error",
      reason,
      timestamp,
    },
    503,
  );
}
