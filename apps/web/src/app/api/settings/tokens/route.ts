/**
 * GET  /api/settings/tokens — List all device tokens for current user
 * POST /api/settings/tokens — Create a new device token
 *
 * POST returns the raw token exactly once. It is never stored or retrievable again.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { deviceTokensRepo } from "@/db/repositories";
import { hashToken } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = deviceTokensRepo.findByUserId(user.id);

  // Never expose the hash to the client
  const items = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
  }));

  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();

  if (!name) {
    return NextResponse.json(
      { error: "Token name is required" },
      { status: 400 },
    );
  }

  if (name.length > 100) {
    return NextResponse.json(
      { error: "Token name must be 100 characters or less" },
      { status: 400 },
    );
  }

  // Generate a random token (48 bytes = 64 base64url chars)
  const rawBytes = crypto.getRandomValues(new Uint8Array(48));
  const rawToken = `lyre_${Buffer.from(rawBytes).toString("base64url")}`;
  const tokenHash = hashToken(rawToken);
  const id = crypto.randomUUID();

  const record = deviceTokensRepo.create({
    id,
    userId: user.id,
    name,
    tokenHash,
  });

  return NextResponse.json(
    {
      id: record.id,
      name: record.name,
      token: rawToken, // Returned exactly once
      createdAt: record.createdAt,
    },
    { status: 201 },
  );
}
