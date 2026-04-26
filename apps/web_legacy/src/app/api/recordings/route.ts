/**
 * GET  /api/recordings — List recordings (paginated, filterable)
 * POST /api/recordings — Create a recording row after presigned upload completes
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import {
  listRecordingsHandler,
  createRecordingHandler,
  type CreateRecordingInput,
} from "@lyre/api/handlers/recordings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const sp = request.nextUrl.searchParams;
  return toNextResponse(
    listRecordingsHandler(ctx, {
      query: sp.get("q"),
      status: sp.get("status"),
      sortBy: sp.get("sortBy"),
      sortDir: sp.get("sortDir"),
      page: sp.get("page"),
      pageSize: sp.get("pageSize"),
      folderId: sp.get("folderId"),
    }),
  );
}

export async function POST(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const body = (await request.json()) as CreateRecordingInput;
  return toNextResponse(createRecordingHandler(ctx, body));
}
