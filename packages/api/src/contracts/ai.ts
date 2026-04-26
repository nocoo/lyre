/**
 * AI provider contracts (client-safe surface).
 *
 * Re-exports the client-safe types/registry data from `@nocoo/next-ai`
 * (which itself splits client vs server exports). Server-only helpers
 * (createAiModel, generateSummary, etc.) live in
 * `@lyre/api/services/ai` and must not be imported from UI code.
 */

export {
  AiProviderRegistry,
  CUSTOM_PROVIDER_INFO,
  isValidProvider,
  type AiProviderInfo,
  type SdkType,
  type AiConfig,
  type AiSettingsInput,
} from "@nocoo/next-ai";

import { AiProviderRegistry, type AiProviderInfo } from "@nocoo/next-ai";

/**
 * lyre originally typed providers as a string union; next-ai's registry is
 * dynamic so providers are plain strings.
 */
export type AiProvider = string;

const defaultRegistry = new AiProviderRegistry();

/** Built-in providers keyed by id (excludes "custom"). */
export const AI_PROVIDERS: Record<string, AiProviderInfo> = Object.fromEntries(
  defaultRegistry.getAll().map((p) => [p.id, p]),
);

/** All valid provider IDs (built-ins plus "custom"). */
export const ALL_PROVIDER_IDS: string[] = defaultRegistry.getAllIds();
