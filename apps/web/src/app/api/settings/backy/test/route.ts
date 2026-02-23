/**
 * POST /api/settings/backy/test — Test Backy connection with current settings.
 *
 * Sends a HEAD request to the configured webhook URL to verify connectivity.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { readBackySettings } from "@/app/api/settings/backy/route";

export const dynamic = "force-dynamic";

export async function POST() {
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

  const start = Date.now();
  try {
    const res = await fetch(settings.webhookUrl, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
    });

    const durationMs = Date.now() - start;

    return NextResponse.json({
      success: res.ok,
      status: res.status,
      durationMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, status: 0, error: message, durationMs: Date.now() - start },
      { status: 502 },
    );
  }
}
