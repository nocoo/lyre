import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { db } from "@/db/index";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Lightweight liveness / health-check endpoint (surety standard).
 *
 * - No authentication required
 * - No caching (force-dynamic + Cache-Control: no-store)
 * - Validates core dependency connectivity (database)
 * - Returns system metadata (version, uptime, timestamp)
 *
 * Error responses sanitize messages to avoid the word "ok"
 * so keyword-based monitors do not produce false positives.
 */
export function GET() {
  return checkHealth(() => {
    db.run(sql`SELECT 1 AS probe`);
  });
}

/**
 * Core health-check logic, extracted for testability.
 *
 * @param probeDb — callback that validates database connectivity.
 *                  Throwing indicates the database is unreachable.
 */
export function checkHealth(probeDb: () => void) {
  const timestamp = new Date().toISOString();
  const uptime = Math.floor(process.uptime());

  try {
    probeDb();

    return respond({
      status: "ok",
      version: APP_VERSION,
      component: "lyre",
      timestamp,
      uptime,
      database: { connected: true },
    });
  } catch (err) {
    const raw =
      err instanceof Error ? err.message : "unexpected database failure";
    const message = sanitize(raw);
    return respond(
      {
        status: "error",
        version: APP_VERSION,
        component: "lyre",
        timestamp,
        uptime,
        database: { connected: false, error: message },
      },
      503,
    );
  }
}

// ── Helpers ──

/** Strip the word "ok" from error messages to avoid false-positive monitors. */
function sanitize(msg: string): string {
  return msg.replace(/\bok\b/gi, "***");
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
