/**
 * Push backup to Backy service.
 *
 * POST /api/settings/backup/push — Export & push current user data to Backy
 *
 * Returns full request/response details for debugging.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { pushBackupToBacky } from "@/services/backup";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pushBackupToBacky(user);

    // Always return full details regardless of success/failure
    const payload = {
      success: result.ok,
      request: result.request,
      response: {
        status: result.status,
        body: result.body,
      },
      durationMs: result.durationMs,
    };

    if (!result.ok) {
      return NextResponse.json(
        { ...payload, error: "Backy rejected the backup" },
        { status: 502 },
      );
    }
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Push failed: ${message}` },
      { status: 500 },
    );
  }
}
