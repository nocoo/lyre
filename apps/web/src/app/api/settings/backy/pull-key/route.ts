/**
 * POST   /api/settings/backy/pull-key — Generate a new pull key
 * DELETE /api/settings/backy/pull-key — Revoke the pull key
 *
 * The pull key authenticates incoming webhook calls from Backy
 * to trigger automatic backup pushes (Pull direction).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import {
  generatePullKey,
  readPullKey,
  savePullKey,
  deletePullKey,
} from "@/services/backy";

export const dynamic = "force-dynamic";

/**
 * Generate (or regenerate) a pull key.
 *
 * If a key already exists it is replaced — callers must update
 * their Backy configuration with the new key.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = generatePullKey();
  savePullKey(user.id, key);

  return NextResponse.json({ pullKey: key });
}

/**
 * Revoke the pull key, disabling Pull webhook access.
 */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const had = readPullKey(user.id);
  if (!had) {
    return NextResponse.json(
      { error: "No pull key configured" },
      { status: 400 },
    );
  }

  deletePullKey(user.id);
  return NextResponse.json({ ok: true });
}
