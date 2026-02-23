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
import { readBackySettings } from "@/app/api/settings/backy/route";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backySettings = readBackySettings(user.id);
  if (!backySettings.webhookUrl || !backySettings.apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "Backy webhook URL and API key must be configured first",
      },
      { status: 400 },
    );
  }

  const result = await pushBackupToBacky(user, {
    webhookUrl: backySettings.webhookUrl,
    apiKey: backySettings.apiKey,
  });

  // Always return full details regardless of success/failure
  const payload = {
    success: result.ok,
    error: result.ok ? undefined : `Backy push failed (HTTP ${result.status})`,
    request: result.request,
    response: {
      status: result.status,
      body: result.body,
    },
    durationMs: result.durationMs,
  };

  if (!result.ok) {
    return NextResponse.json(payload, { status: 502 });
  }
  return NextResponse.json(payload);
}
