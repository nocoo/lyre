/**
 * AI service module — delegates to @nocoo/next-ai for provider/config/client.
 *
 * Provider registry, config resolution, and client/model creation all live in
 * `@nocoo/next-ai`. This module re-exports the public surface for backward
 * compatibility and adds lyre-specific summary prompt helpers.
 */

import {
  AiProviderRegistry,
  CUSTOM_PROVIDER_INFO as NEXT_AI_CUSTOM_PROVIDER_INFO,
  type AiProviderInfo,
} from "@nocoo/next-ai";

// ── Re-exports from @nocoo/next-ai ──

export {
  AiProviderRegistry,
  isValidProvider,
  resolveAiConfig,
  type SdkType,
  type AiProviderInfo,
  type AiConfig,
  type AiSettingsInput,
} from "@nocoo/next-ai";

export { createAiModel } from "@nocoo/next-ai/server";

/**
 * Backward-compatible alias. lyre originally typed providers as a string union;
 * next-ai's registry is dynamic so providers are plain strings.
 */
export type AiProvider = string;

// ── Compatibility shims for the old static `AI_PROVIDERS` record ──

const defaultRegistry = new AiProviderRegistry();

/** Built-in providers keyed by id (excludes "custom"). */
export const AI_PROVIDERS: Record<string, AiProviderInfo> = Object.fromEntries(
  defaultRegistry.getAll().map((p) => [p.id, p]),
);

/** All valid provider IDs (built-ins plus "custom"). */
export const ALL_PROVIDER_IDS: string[] = defaultRegistry.getAllIds();

/** Custom provider sentinel (no baseURL/sdkType — supplied at runtime). */
export const CUSTOM_PROVIDER_INFO = NEXT_AI_CUSTOM_PROVIDER_INFO;

/**
 * Look up a built-in provider's static config. Returns undefined for "custom"
 * or unknown providers, matching the previous lyre behaviour.
 */
export function getProviderConfig(
  providerId: string,
): AiProviderInfo | undefined {
  if (providerId === "custom") return undefined;
  return defaultRegistry.get(providerId);
}

// ── Summary generation (lyre-specific) ──

const SUMMARY_PROMPT = `Summarize the following transcript concisely in the same language as the transcript.

<transcript>
{transcript}
</transcript>`;

/** Build the summary prompt from a transcript. */
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
