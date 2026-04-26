/**
 * POST /api/settings/backup/push — Export & push current user data to Backy.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { pushBackupHandler } from "@lyre/api/handlers/settings-backup";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(await pushBackupHandler(ctx));
}
