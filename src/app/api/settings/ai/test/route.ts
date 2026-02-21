/**
 * POST /api/settings/ai/test — Test AI connection with current settings.
 *
 * Sends a minimal prompt to verify the API key and endpoint work.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { settingsRepo } from "@/db/repositories";
import {
  resolveAiConfig,
  createAiClient,
  type AiProvider,
  type SdkType,
} from "@/services/ai";
import { generateText } from "ai";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read settings from DB
  const all = settingsRepo.findByUserId(user.id);
  const map = new Map(all.map((s) => [s.key, s.value]));
  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";
  const baseURL = map.get("ai.baseURL") ?? "";
  const sdkType = map.get("ai.sdkType") ?? "";

  if (!provider || !apiKey) {
    return NextResponse.json(
      { error: "AI provider and API key must be configured first" },
      { status: 400 },
    );
  }

  try {
    const config = resolveAiConfig({
      provider: provider as AiProvider,
      apiKey,
      model,
      baseURL: baseURL || undefined,
      sdkType: (sdkType || undefined) as SdkType | undefined,
    });

    const client = createAiClient(config);

    const { text } = await generateText({
      model: client(config.model),
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 10,
    });

    return NextResponse.json({
      success: true,
      response: text.trim(),
      model: config.model,
      provider: config.provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 },
    );
  }
}
