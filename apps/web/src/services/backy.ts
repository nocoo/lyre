/**
 * Backy remote backup service.
 *
 * Configuration helpers for reading, masking, and validating
 * Backy webhook settings stored in the user settings table.
 *
 * Supports bidirectional communication:
 * - Push: Lyre exports data → POST to Backy webhook
 * - Pull: Backy calls Lyre webhook → Lyre auto-executes Push
 *
 * Separated from API routes so that any layer can import these
 * without cross-route dependencies.
 */

import { randomBytes } from "crypto";
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

/** A single backup entry returned by the Backy webhook GET endpoint. */
export interface BackyBackupEntry {
  id: string;
  tag: string;
  environment: string;
  file_size: number;
  is_single_json: number;
  created_at: string;
}

/** Response from the Backy webhook GET endpoint. */
export interface BackyHistoryResponse {
  project_name: string;
  environment: string | null;
  total_backups: number;
  recent_backups: BackyBackupEntry[];
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

// ── Remote history ──

export interface BackyHistoryResult {
  ok: boolean;
  status: number;
  data: BackyHistoryResponse | null;
  error: string | null;
}

/**
 * Fetch backup history from the Backy webhook (GET).
 *
 * Returns the total backup count and the most recent entries
 * as reported by the remote Backy service.
 */
export async function fetchBackyHistory(
  credentials: BackyCredentials,
): Promise<BackyHistoryResult> {
  try {
    const res = await fetch(credentials.webhookUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        data: null,
        error: text || `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as BackyHistoryResponse;
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, error: message };
  }
}

// ── Pull Key management ──

const PULL_KEY_SETTING = "backy.pullKey";

/** Generate a cryptographically secure pull key (32 hex bytes = 64 chars). */
export function generatePullKey(): string {
  return randomBytes(32).toString("hex");
}

/** Read the pull key for a user. Returns empty string if not set. */
export function readPullKey(userId: string): string {
  const setting = settingsRepo.findByKey(userId, PULL_KEY_SETTING);
  return setting?.value ?? "";
}

/** Save a pull key for a user (upsert). */
export function savePullKey(userId: string, key: string): void {
  settingsRepo.upsert(userId, PULL_KEY_SETTING, key);
}

/** Delete the pull key for a user. Returns true if a key was deleted. */
export function deletePullKey(userId: string): boolean {
  return settingsRepo.delete(userId, PULL_KEY_SETTING);
}

/**
 * Look up the user ID that owns a given pull key.
 *
 * Used for authenticating incoming Pull webhook requests
 * where the caller provides the key via X-Webhook-Key header.
 *
 * Returns null if no user has this key.
 */
export function findUserIdByPullKey(pullKey: string): string | null {
  const setting = settingsRepo.findByKeyAndValue(PULL_KEY_SETTING, pullKey);
  return setting?.userId ?? null;
}
