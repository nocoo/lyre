/**
 * GET /api/search?q=... — Global search for command palette.
 */

import type { NextRequest } from "next/server";
import {
  buildContext,
  toNextResponse,
  unauthorized401,
} from "@/lib/handler-adapter";
import { searchHandler } from "@lyre/api/handlers/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { ctx, unauthorized } = await buildContext(request);
  if (unauthorized) return unauthorized401();
  const query = request.nextUrl.searchParams.get("q");
  return toNextResponse(searchHandler(ctx, query));
}
