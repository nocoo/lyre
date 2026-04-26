/**
 * GET  /api/settings/backup — Export all user data as JSON
 * POST /api/settings/backup — Import user data from JSON backup
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  exportBackupHandler,
  importBackupHandler,
} from "@lyre/api/handlers/settings-backup";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(exportBackupHandler(ctx));
}

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return toNextResponse(importBackupHandler(ctx, body));
}
