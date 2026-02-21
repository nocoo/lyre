/**
 * POST /api/recordings/[id]/transcribe
 *
 * Triggers an ASR transcription job for a recording.
 * 1. Validates recording exists and belongs to user
 * 2. Generates a presigned GET URL for the audio file
 * 3. Submits the URL to the ASR provider
 * 4. Creates a job record in the database
 * 5. Updates the recording status to "transcribing"
 *
 * Returns the created job record.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo, jobsRepo } from "@/db/repositories";
import { presignGet } from "@/services/oss";
import { getAsrProvider } from "@/services/asr-provider";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const recording = recordingsRepo.findById(id);

  if (!recording || recording.userId !== user.id) {
    return NextResponse.json(
      { error: "Recording not found" },
      { status: 404 },
    );
  }

  // Only allow transcription from "uploaded", "completed", or "failed" status
  if (recording.status === "transcribing") {
    return NextResponse.json(
      { error: "Recording is already being transcribed" },
      { status: 409 },
    );
  }

  try {
    // Generate a long-lived presigned URL for the ASR service to download
    // ASR jobs can take minutes, so use a generous expiry (1 hour)
    const audioUrl = presignGet(recording.ossKey, 3600);

    // Submit to ASR provider
    const provider = getAsrProvider();
    const submitResult = await provider.submit(audioUrl);

    const jobId = crypto.randomUUID();

    // Create job record
    const job = jobsRepo.create({
      id: jobId,
      recordingId: id,
      taskId: submitResult.output.task_id,
      requestId: submitResult.request_id,
      status: submitResult.output.task_status,
    });

    // Update recording status to "transcribing"
    recordingsRepo.update(id, { status: "transcribing" });

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error("Failed to submit ASR job:", error);
    return NextResponse.json(
      {
        error: "Failed to submit transcription job",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
