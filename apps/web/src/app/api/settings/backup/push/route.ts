/**
 * Push backup to Backy service.
 *
 * POST /api/settings/backup/push — Export & push current user data to Backy
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
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Backy rejected the backup",
          status: result.status,
          detail: result.body,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, backy: result.body });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Push failed: ${message}` },
      { status: 500 },
    );
  }
}
