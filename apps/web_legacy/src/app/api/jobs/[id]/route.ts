/**
 * GET /api/jobs/[id]
 *
 * Polls a transcription job status.
 *
 * Delegates all processing to the job-processor service.
 * This route only handles auth, ownership checks, and HTTP concerns.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { jobsRepo, recordingsRepo } from "@/db/repositories";
import { getAsrProvider } from "@/services/asr-provider";
import { pollJob } from "@/services/job-processor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const job = jobsRepo.findById(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Verify the job belongs to the user's recording
  const recording = recordingsRepo.findById(job.recordingId);
  if (!recording || recording.userId !== user.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // If job is already in a terminal state, return it directly
  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    return NextResponse.json(job);
  }

  // Poll and process
  try {
    const provider = getAsrProvider();
    const result = await pollJob(job, provider);
    return NextResponse.json(result.job);
  } catch (error) {
    console.error("Failed to poll ASR job:", error);
    return NextResponse.json(
      {
        error: "Failed to poll job status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
