/**
 * GET  /api/settings/ai — Read AI configuration for current user
 * PUT  /api/settings/ai — Save AI configuration
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { settingsRepo } from "@/db/repositories";
import { isValidProvider, type AiProvider, type SdkType } from "@/services/ai";

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
    baseURL: map.get("ai.baseURL") ?? "",
    sdkType: (map.get("ai.sdkType") ?? "") as SdkType | "",
  };
}

export type AiSettingsResponse = ReturnType<typeof readAiSettings>;

function maskApiKey(key: string): string {
  if (!key) return "";
  return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = readAiSettings(user.id);
  return NextResponse.json({
    ...settings,
    apiKey: maskApiKey(settings.apiKey),
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
    baseURL?: string;
    sdkType?: string;
  };

  // Validate provider if provided
  if (body.provider !== undefined && body.provider !== "") {
    if (!isValidProvider(body.provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${body.provider}` },
        { status: 400 },
      );
    }
  }

  // Validate sdkType if provided
  if (body.sdkType !== undefined && body.sdkType !== "") {
    if (body.sdkType !== "openai" && body.sdkType !== "anthropic") {
      return NextResponse.json(
        { error: `Invalid SDK type: ${body.sdkType}` },
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
  if (body.baseURL !== undefined) {
    settingsRepo.upsert(user.id, "ai.baseURL", body.baseURL);
  }
  if (body.sdkType !== undefined) {
    settingsRepo.upsert(user.id, "ai.sdkType", body.sdkType);
  }

  const updated = readAiSettings(user.id);
  return NextResponse.json({
    ...updated,
    apiKey: maskApiKey(updated.apiKey),
    hasApiKey: !!updated.apiKey,
  });
}
