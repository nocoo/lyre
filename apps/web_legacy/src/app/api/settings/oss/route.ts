/**
 * GET /api/settings/oss — Scan OSS objects, cross-reference with DB, return per-user breakdown.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { ossScanHandler } from "@lyre/api/handlers/settings-oss";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(await ossScanHandler(ctx));
}
