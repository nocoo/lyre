import { NextResponse, type NextRequest } from "next/server";
import { MOCK_RECORDING_DETAILS } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const detail = MOCK_RECORDING_DETAILS.find((d) => d.id === id);

  if (!detail) {
    return NextResponse.json(
      { error: "Recording not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(detail);
}
