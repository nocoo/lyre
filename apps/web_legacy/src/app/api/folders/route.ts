/**
 * GET  /api/folders — List all folders for the current user
 * POST /api/folders — Create a new folder
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  listFoldersHandler,
  createFolderHandler,
} from "@lyre/api/handlers/folders";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  return toNextResponse(listFoldersHandler(ctx));
}

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as { name?: string; icon?: string };
  return toNextResponse(createFolderHandler(ctx, body));
}
