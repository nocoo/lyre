/**
 * Data backup API.
 *
 * GET  /api/settings/backup — Export all user data as JSON
 * POST /api/settings/backup — Import user data from JSON backup
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { exportBackup, importBackup, validateBackup } from "@/services/backup";

export const dynamic = "force-dynamic";

// ── GET: Export ──

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backup = exportBackup(user);
  return NextResponse.json(backup);
}

// ── POST: Import ──

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const validation = validateBackup(body);
  if (validation !== null) {
    return NextResponse.json(
      { error: `Invalid backup: ${validation}` },
      { status: 400 },
    );
  }

  try {
    const counts = importBackup(user.id, body as Parameters<typeof importBackup>[1]);
    return NextResponse.json({
      success: true,
      imported: counts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Import failed: ${message}` },
      { status: 500 },
    );
  }
}
