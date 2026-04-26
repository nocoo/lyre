/**
 * ASR Provider factory.
 *
 * Returns mock or real ASR provider based on environment.
 * This module is the single point to swap between mock and real API.
 */

import {
  createMockAsrProvider,
  createRealAsrProvider,
  type AsrProvider,
} from "./asr";

let provider: AsrProvider | null = null;

/**
 * Get the ASR provider singleton.
 * Uses real DashScope provider when DASHSCOPE_API_KEY is set,
 * otherwise falls back to mock provider.
 */
export function getAsrProvider(): AsrProvider {
  if (provider) return provider;

  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (apiKey) {
    provider = createRealAsrProvider(apiKey);
    return provider;
  }

  // Default to mock provider with realistic timing
  provider = createMockAsrProvider({
    pollsUntilRunning: 1,
    pollsUntilDone: 3,
  });

  return provider;
}

/**
 * Reset the provider singleton (useful for testing).
 */
export function resetAsrProvider(): void {
  provider = null;
}

/**
 * Set a custom provider (useful for testing).
 */
export function setAsrProvider(custom: AsrProvider): void {
  provider = custom;
}
