/**
 * GET  /api/settings/ai — Read AI configuration for current user
 * PUT  /api/settings/ai — Save AI configuration
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { settingsRepo } from "@/db/repositories";
import { AI_PROVIDERS, type AiProvider } from "@/services/ai";

export const dynamic = "force-dynamic";

/** Read all AI settings for a user and return a typed object. */
function readAiSettings(userId: string) {
  const all = settingsRepo.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));
  return {
    provider: (map.get("ai.provider") ?? "") as AiProvider | "",
    apiKey: map.get("ai.apiKey") ?? "",
    model: map.get("ai.model") ?? "",
    autoSummarize: map.get("ai.autoSummarize") === "true",
  };
}

export type AiSettingsResponse = ReturnType<typeof readAiSettings>;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = readAiSettings(user.id);
  // Mask the API key for security (show last 4 chars only)
  return NextResponse.json({
    ...settings,
    apiKey: settings.apiKey ? `${"*".repeat(Math.max(0, settings.apiKey.length - 4))}${settings.apiKey.slice(-4)}` : "",
    hasApiKey: !!settings.apiKey,
  });
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    provider?: string;
    apiKey?: string;
    model?: string;
    autoSummarize?: boolean;
  };

  // Validate provider if provided
  if (body.provider !== undefined && body.provider !== "") {
    if (!AI_PROVIDERS[body.provider as AiProvider]) {
      return NextResponse.json(
        { error: `Invalid provider: ${body.provider}` },
        { status: 400 },
      );
    }
  }

  // Save each field
  if (body.provider !== undefined) {
    settingsRepo.upsert(user.id, "ai.provider", body.provider);
  }
  if (body.apiKey !== undefined) {
    settingsRepo.upsert(user.id, "ai.apiKey", body.apiKey);
  }
  if (body.model !== undefined) {
    settingsRepo.upsert(user.id, "ai.model", body.model);
  }
  if (body.autoSummarize !== undefined) {
    settingsRepo.upsert(user.id, "ai.autoSummarize", String(body.autoSummarize));
  }

  const updated = readAiSettings(user.id);
  return NextResponse.json({
    ...updated,
    apiKey: updated.apiKey ? `${"*".repeat(Math.max(0, updated.apiKey.length - 4))}${updated.apiKey.slice(-4)}` : "",
    hasApiKey: !!updated.apiKey,
  });
}
