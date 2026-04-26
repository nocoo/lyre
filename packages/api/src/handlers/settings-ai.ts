/**
 * Handlers for `/api/settings/ai` and `/api/settings/ai/test`.
 */

import { generateText } from "ai";
import { makeRepos, type SettingsRepo } from "../db/repositories";
import {
  isValidProvider,
  resolveAiConfig,
  createAiModel,
  type AiProvider,
  type SdkType,
} from "../services/ai";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  unauthorized,
  type HandlerResponse,
} from "./http";

interface AiSettings {
  provider: AiProvider | "";
  apiKey: string;
  model: string;
  autoSummarize: boolean;
  baseURL: string;
  sdkType: SdkType | "";
}

async function readAiSettings(
  settings: SettingsRepo,
  userId: string,
): Promise<AiSettings> {
  const all = await settings.findByUserId(userId);
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

function maskApiKey(key: string): string {
  if (!key) return "";
  return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export async function getAiSettingsHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { settings } = makeRepos(ctx.db);
  const aiSettings = await readAiSettings(settings, ctx.user.id);
  return json({
    ...aiSettings,
    apiKey: maskApiKey(aiSettings.apiKey),
    hasApiKey: !!aiSettings.apiKey,
  });
}

export interface UpdateAiSettingsInput {
  provider?: string;
  apiKey?: string;
  model?: string;
  autoSummarize?: boolean;
  baseURL?: string;
  sdkType?: string;
}

export async function updateAiSettingsHandler(
  ctx: RuntimeContext,
  body: UpdateAiSettingsInput,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  if (body.provider !== undefined && body.provider !== "") {
    if (!isValidProvider(body.provider)) {
      return badRequest(`Invalid provider: ${body.provider}`);
    }
  }
  if (body.sdkType !== undefined && body.sdkType !== "") {
    if (body.sdkType !== "openai" && body.sdkType !== "anthropic") {
      return badRequest(`Invalid SDK type: ${body.sdkType}`);
    }
  }
  const userId = ctx.user.id;
  const { settings } = makeRepos(ctx.db);
  if (body.provider !== undefined)
    await settings.upsert(userId, "ai.provider", body.provider);
  if (body.apiKey !== undefined)
    await settings.upsert(userId, "ai.apiKey", body.apiKey);
  if (body.model !== undefined)
    await settings.upsert(userId, "ai.model", body.model);
  if (body.autoSummarize !== undefined)
    await settings.upsert(userId, "ai.autoSummarize", String(body.autoSummarize));
  if (body.baseURL !== undefined)
    await settings.upsert(userId, "ai.baseURL", body.baseURL);
  if (body.sdkType !== undefined)
    await settings.upsert(userId, "ai.sdkType", body.sdkType);

  const updated = await readAiSettings(settings, userId);
  return json({
    ...updated,
    apiKey: maskApiKey(updated.apiKey),
    hasApiKey: !!updated.apiKey,
  });
}

export async function testAiSettingsHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { settings } = makeRepos(ctx.db);
  const all = await settings.findByUserId(ctx.user.id);
  const map = new Map(all.map((s) => [s.key, s.value]));
  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";
  const baseURL = map.get("ai.baseURL") ?? "";
  const sdkType = map.get("ai.sdkType") ?? "";

  if (!provider || !apiKey) {
    return badRequest("AI provider and API key must be configured first");
  }

  try {
    const config = resolveAiConfig({
      provider: provider as AiProvider,
      apiKey,
      model,
      ...(baseURL ? { baseURL } : {}),
      ...(sdkType ? { sdkType: sdkType as SdkType } : {}),
    });
    const client = createAiModel(config);
    const { text } = await generateText({
      model: client,
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 10,
    });
    return json({
      success: true,
      response: text.trim(),
      model: config.model,
      provider: config.provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ success: false, error: message }, 502);
  }
}
