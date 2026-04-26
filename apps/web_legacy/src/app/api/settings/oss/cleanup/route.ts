/**
 * OSS orphan cleanup API.
 *
 * POST /api/settings/oss/cleanup — Delete orphan files/folders from OSS.
 *
 * Accepts a list of object keys to delete. Only keys confirmed as orphans
 * (no matching DB record) are actually deleted.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { deleteObjects } from "@/services/oss";
import { recordingsRepo, jobsRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

interface CleanupRequest {
  /** Object keys to delete */
  keys: string[];
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CleanupRequest;
  const { keys } = body;

  if (!Array.isArray(keys) || keys.length === 0) {
    return NextResponse.json(
      { error: "keys must be a non-empty array" },
      { status: 400 },
    );
  }

  if (keys.length > 5000) {
    return NextResponse.json(
      { error: "Too many keys (max 5000 per request)" },
      { status: 400 },
    );
  }

  // Validate each key is actually an orphan before deleting
  const confirmedOrphans: string[] = [];
  const skipped: string[] = [];

  for (const key of keys) {
    if (typeof key !== "string" || !key) {
      skipped.push(key);
      continue;
    }

    if (key.startsWith("uploads/")) {
      // uploads/{userId}/{recordingId}/{file}
      const parts = key.split("/");
      if (parts.length < 4) {
        skipped.push(key);
        continue;
      }
      const recordingId = parts[2]!;
      const recording = recordingsRepo.findById(recordingId);
      if (recording) {
        // Has a DB record — skip (not an orphan)
        skipped.push(key);
      } else {
        confirmedOrphans.push(key);
      }
    } else if (key.startsWith("results/")) {
      // results/{jobId}/{file}
      const parts = key.split("/");
      if (parts.length < 3) {
        skipped.push(key);
        continue;
      }
      const jobId = parts[1]!;
      const job = jobsRepo.findById(jobId);
      if (job) {
        skipped.push(key);
      } else {
        confirmedOrphans.push(key);
      }
    } else {
      // Unknown prefix — skip for safety
      skipped.push(key);
    }
  }

  // Batch delete confirmed orphans
  let deleted = 0;
  if (confirmedOrphans.length > 0) {
    deleted = await deleteObjects(confirmedOrphans);
  }

  return NextResponse.json({
    deleted,
    requested: keys.length,
    confirmed: confirmedOrphans.length,
    skipped: skipped.length,
  });
}
