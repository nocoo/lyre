/**
 * AI service module.
 *
 * Provides LLM-powered summarization via Anthropic-compatible APIs.
 * Supports multiple providers (Anthropic, GLM, MiniMax, AIHubMix) through
 * the Vercel AI SDK Anthropic provider with configurable base URLs.
 */

import { createAnthropic } from "@ai-sdk/anthropic";

// ── Provider registry ──

export type AiProvider = "anthropic" | "glm" | "minimax" | "aihubmix";

export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  baseURL: string;
  defaultModel: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
  },
  glm: {
    id: "glm",
    label: "GLM (Zhipu)",
    baseURL: "https://open.bigmodel.cn/api/anthropic",
    defaultModel: "glm-4",
  },
  minimax: {
    id: "minimax",
    label: "MiniMax",
    baseURL: "https://api.minimaxi.com/anthropic",
    defaultModel: "MiniMax-M1",
  },
  aihubmix: {
    id: "aihubmix",
    label: "AIHubMix",
    baseURL: "https://aihubmix.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
  },
};

// ── Config resolution ──

export interface AiConfig {
  provider: AiProvider;
  baseURL: string;
  apiKey: string;
  model: string;
}

/** User-facing settings (stored in DB). */
export interface AiSettingsInput {
  provider: AiProvider;
  apiKey: string;
  model: string; // empty = use provider default
}

/**
 * Look up a provider's static config.
 */
export function getProviderConfig(
  providerId: AiProvider,
): AiProviderInfo | undefined {
  return AI_PROVIDERS[providerId];
}

/**
 * Resolve user settings into a complete AiConfig.
 * Fills in baseURL and default model from the provider registry.
 */
export function resolveAiConfig(input: AiSettingsInput): AiConfig {
  if (!input.apiKey) {
    throw new Error("API key is required");
  }

  const info = getProviderConfig(input.provider);
  if (!info) {
    throw new Error(`Unknown AI provider: ${input.provider}`);
  }

  return {
    provider: input.provider,
    baseURL: info.baseURL,
    apiKey: input.apiKey,
    model: input.model || info.defaultModel,
  };
}

// ── Client creation ──

/**
 * Create a Vercel AI SDK Anthropic provider instance.
 * Returns a function that creates model references: `client(modelId)`.
 */
export function createAiClient(config: AiConfig) {
  return createAnthropic({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

// ── Summary generation ──

const SUMMARY_PROMPT = `Summarize the following transcript concisely in the same language as the transcript.

<transcript>
{transcript}
</transcript>`;

/**
 * Build the summary prompt from a transcript.
 */
export function buildSummaryPrompt(transcript: string): string {
  if (!transcript.trim()) {
    throw new Error("Transcript is empty");
  }
  return SUMMARY_PROMPT.replace("{transcript}", transcript);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGenerateFn = (opts: any) => Promise<{ text: string }>;

/**
 * Generate a summary from a transcript.
 *
 * @param transcript - The full text of the transcription
 * @param generate - The text generation function (injected for testability)
 * @returns The generated summary text
 */
export async function generateSummary(
  transcript: string,
  generate: AnyGenerateFn,
): Promise<string> {
  const prompt = buildSummaryPrompt(transcript);
  const result = await generate({ prompt });
  return result.text;
}
