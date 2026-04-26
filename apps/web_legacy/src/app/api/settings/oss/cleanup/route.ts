/**
 * POST /api/settings/oss/cleanup — Delete orphan OSS objects.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  ossCleanupHandler,
  type OssCleanupInput,
} from "@lyre/api/handlers/settings-oss";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as OssCleanupInput;
  return toNextResponse(await ossCleanupHandler(ctx, body));
}
