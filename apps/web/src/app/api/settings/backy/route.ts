/**
 * GET  /api/settings/backy — Read Backy configuration for current user
 * PUT  /api/settings/backy — Save Backy configuration
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { settingsRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

/** Read Backy settings for a user and return a typed object. */
export function readBackySettings(userId: string) {
  const all = settingsRepo.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));
  return {
    webhookUrl: map.get("backy.webhookUrl") ?? "",
    apiKey: map.get("backy.apiKey") ?? "",
  };
}

export type BackySettingsResponse = {
  webhookUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  environment: "prod" | "dev";
};

function maskApiKey(key: string): string {
  if (!key) return "";
  return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

function getEnvironment(): "prod" | "dev" {
  return process.env.NODE_ENV === "production" ? "prod" : "dev";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = readBackySettings(user.id);
  return NextResponse.json({
    webhookUrl: settings.webhookUrl,
    apiKey: maskApiKey(settings.apiKey),
    hasApiKey: !!settings.apiKey,
    environment: getEnvironment(),
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
