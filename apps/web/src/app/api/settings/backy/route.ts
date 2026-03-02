/**
 * GET  /api/settings/backy — Read Backy configuration for current user
 * PUT  /api/settings/backy — Save Backy configuration
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { settingsRepo } from "@/db/repositories";
import {
  readBackySettings,
  readPullKey,
  maskApiKey,
  getEnvironment,
} from "@/services/backy";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = readBackySettings(user.id);
  const pullKey = readPullKey(user.id);
  return NextResponse.json({
    webhookUrl: settings.webhookUrl,
    apiKey: maskApiKey(settings.apiKey),
    hasApiKey: !!settings.apiKey,
    environment: getEnvironment(),
    hasPullKey: !!pullKey,
    pullKey: pullKey || null,
  });
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    webhookUrl?: string;
    apiKey?: string;
  };

  if (body.webhookUrl !== undefined) {
    settingsRepo.upsert(user.id, "backy.webhookUrl", body.webhookUrl);
  }
  if (body.apiKey !== undefined) {
    settingsRepo.upsert(user.id, "backy.apiKey", body.apiKey);
  }

  const updated = readBackySettings(user.id);
  return NextResponse.json({
    webhookUrl: updated.webhookUrl,
    apiKey: maskApiKey(updated.apiKey),
    hasApiKey: !!updated.apiKey,
  });
}
