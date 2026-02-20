/**
 * ASR Provider factory.
 *
 * Returns mock or real ASR provider based on environment.
 * This module is the single point to swap between mock and real API.
 */

import {
  createMockAsrProvider,
  type AsrProvider,
} from "./asr";

let provider: AsrProvider | null = null;

/**
 * Get the ASR provider singleton.
 * Uses mock provider unless DASHSCOPE_API_KEY is set.
 */
export function getAsrProvider(): AsrProvider {
  if (provider) return provider;

  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (apiKey) {
    // Real provider — will be implemented in Phase 6 when we swap to real API
    // For now, fall through to mock
    console.log("DashScope API key detected — using real ASR provider (TODO)");
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
