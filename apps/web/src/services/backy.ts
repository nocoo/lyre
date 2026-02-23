/**
 * Backy remote backup service.
 *
 * Configuration helpers for reading, masking, and validating
 * Backy webhook settings stored in the user settings table.
 *
 * Separated from API routes so that any layer can import these
 * without cross-route dependencies.
 */

import { settingsRepo } from "@/db/repositories";

// ── Types ──

export interface BackyCredentials {
  webhookUrl: string;
  apiKey: string;
}

export interface BackySettingsResponse {
  webhookUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  environment: "prod" | "dev";
}

// ── Helpers ──

/** Mask an API key, showing only the last 4 characters. */
export function maskApiKey(key: string): string {
  if (!key) return "";
  return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

/** Return "prod" or "dev" based on NODE_ENV. */
export function getEnvironment(): "prod" | "dev" {
  return process.env.NODE_ENV === "production" ? "prod" : "dev";
}

// ── Settings read ──

/** Read Backy settings for a user from the key-value settings table. */
export function readBackySettings(userId: string): BackyCredentials {
  const all = settingsRepo.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));
  return {
    webhookUrl: map.get("backy.webhookUrl") ?? "",
    apiKey: map.get("backy.apiKey") ?? "",
  };
}
