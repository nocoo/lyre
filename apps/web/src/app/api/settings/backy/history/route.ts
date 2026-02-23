/**
 * GET /api/settings/backy/history — Fetch remote backup history from Backy.
 *
 * Proxies a GET request to the configured Backy webhook URL and returns
 * the total backup count and recent backup entries.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { readBackySettings, fetchBackyHistory } from "@/services/backy";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = readBackySettings(user.id);
  if (!settings.webhookUrl || !settings.apiKey) {
    return NextResponse.json(
      { error: "Webhook URL and API key must be configured first" },
      { status: 400 },
    );
  }

  const result = await fetchBackyHistory({
    webhookUrl: settings.webhookUrl,
    apiKey: settings.apiKey,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? `HTTP ${result.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}
