/**
 * Pull webhook — called by Backy to trigger an automatic backup push.
 *
 * HEAD /api/backy/pull — Connection test (verify key validity)
 * POST /api/backy/pull — Trigger a full backup push to the user's Backy config
 *
 * Authentication: X-Webhook-Key header containing the user's pull key.
 * This endpoint does NOT use NextAuth — it is designed for machine-to-machine calls.
 */

import { NextResponse, type NextRequest } from "next/server";
import { usersRepo } from "@/db/repositories";
import {
  findUserIdByPullKey,
  readBackySettings,
} from "@/services/backy";
import { pushBackupToBacky } from "@/services/backup";

export const dynamic = "force-dynamic";

/**
 * Authenticate an incoming webhook request via X-Webhook-Key.
 * Returns the userId on success, or a NextResponse error on failure.
 */
function authenticateWebhookKey(
  request: NextRequest,
): string | NextResponse {
  const key = request.headers.get("x-webhook-key");
  if (!key) {
    return NextResponse.json(
      { error: "Missing X-Webhook-Key header" },
      { status: 401 },
    );
  }

  const userId = findUserIdByPullKey(key);
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid webhook key" },
      { status: 401 },
    );
  }

  return userId;
}

/**
 * HEAD — verify the webhook key is valid.
 */
export async function HEAD(request: NextRequest) {
  const result = authenticateWebhookKey(request);
  if (result instanceof NextResponse) return result;

  // Key is valid — return 200 with no body
  return new NextResponse(null, { status: 200 });
}

/**
 * POST — trigger a full backup push.
 *
 * Flow:
 * 1. Validate X-Webhook-Key → find userId
 * 2. Read the user's Backy Push config (webhookUrl + apiKey)
 * 3. Export all user data and push to Backy
 * 4. Return the push result
 */
export async function POST(request: NextRequest) {
  const start = Date.now();
  const result = authenticateWebhookKey(request);
  if (result instanceof NextResponse) return result;

  const userId = result;

  // Load push config
  const pushConfig = readBackySettings(userId);
  if (!pushConfig.webhookUrl || !pushConfig.apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Push configuration not set. Configure Backy webhook URL and API key first.",
      },
      { status: 422 },
    );
  }

  // Load user record (needed by pushBackupToBacky for data export)
  const user = usersRepo.findById(userId);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "User not found" },
      { status: 401 },
    );
  }

  // Execute push
  const pushResult = await pushBackupToBacky(user, pushConfig);
  const durationMs = Date.now() - start;

  if (!pushResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Backup push failed (HTTP ${pushResult.status})`,
        durationMs,
        tag: pushResult.request.tag,
        fileName: pushResult.request.fileName,
        stats: pushResult.request.backupStats,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: `Backup pushed successfully (${durationMs}ms)`,
    durationMs,
    tag: pushResult.request.tag,
    fileName: pushResult.request.fileName,
    stats: pushResult.request.backupStats,
  });
}
