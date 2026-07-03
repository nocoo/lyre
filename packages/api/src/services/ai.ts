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

/**
 * Build a summary prompt that folds in the previous summary and/or an
 * optional one-shot user feedback.
 *
 * The manual Regenerate flow uses this so the LLM can iterate on the
 * previous version according to the user's specific complaint instead of
 * blindly re-generating. When BOTH previousSummary and feedback are
 * empty/whitespace this delegates to `buildSummaryPrompt` so callers
 * that don't have either (auto/cron path) keep their exact behavior.
 *
 * Neither field is escaped — both are wrapped in dedicated XML-ish tags
 * (`<previous-summary>`, `<user-feedback>`) which are enough to keep the
 * LLM from confusing them with the transcript.
 */
export function buildSummaryPromptWithFeedback(
  transcript: string,
  opts: {
    previousSummary?: string | null;
    feedback?: string | null;
  },
): string {
  if (!transcript.trim()) {
    throw new Error("Transcript is empty");
  }
  const prev = opts.previousSummary?.trim() ? opts.previousSummary : null;
  const fb = opts.feedback?.trim() ? opts.feedback : null;
  if (!prev && !fb) {
    return buildSummaryPrompt(transcript);
  }

  // Compose an instruction line matching what the caller actually
  // supplied. Keeping this in one place (instead of three prompt
  // constants) makes it easy to tweak wording later without duplication.
  let instruction: string;
  if (prev && fb) {
    instruction =
      "The previous attempt is included below. The user was unsatisfied with it " +
      "and left feedback. Treat the feedback as an instruction: address the " +
      "concerns and, using the full transcript as the source of truth, produce a " +
      "new summary. Do not simply repeat the previous version — improve on it.";
  } else if (prev) {
    instruction =
      "The previous attempt is included below. Produce an improved version " +
      "based on the full transcript. Do not simply repeat the previous version.";
  } else {
    instruction =
      "The user was unsatisfied with the previous summary and left this feedback. " +
      "Treat it as an instruction: address the concerns and, combined with the " +
      "transcript, produce a new summary.";
  }

  const sections: string[] = [
    "Summarize the following transcript concisely in the same language as the transcript.",
    instruction,
  ];
  if (prev) {
    sections.push(`<previous-summary>\n${prev}\n</previous-summary>`);
  }
  if (fb) {
    sections.push(`<user-feedback>\n${fb}\n</user-feedback>`);
  }
  sections.push(`<transcript>\n${transcript}\n</transcript>`);
  return sections.join("\n\n");
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
