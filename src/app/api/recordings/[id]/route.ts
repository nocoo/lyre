import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import {
  recordingsRepo,
  transcriptionsRepo,
  jobsRepo,
} from "@/db/repositories";
import { deleteObject } from "@/services/oss";
import type { RecordingDetail, TranscriptionSentence } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
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

  // Fetch related transcription and latest job
  const dbTranscription = transcriptionsRepo.findByRecordingId(id);
  const latestJob = jobsRepo.findLatestByRecordingId(id) ?? null;

  const transcription = dbTranscription
    ? {
        ...dbTranscription,
        sentences: transcriptionsRepo.parseSentences(
          dbTranscription.sentences,
        ) as TranscriptionSentence[],
      }
    : null;

  const detail: RecordingDetail = {
    ...recording,
    tags: recordingsRepo.parseTags(recording.tags),
    transcription,
    latestJob,
  };

  return NextResponse.json(detail);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = recordingsRepo.findById(id);

  if (!existing || existing.userId !== user.id) {
    return NextResponse.json(
      { error: "Recording not found" },
      { status: 404 },
    );
  }

  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    tags?: string[];
  };

  // Build update object, omitting undefined fields to satisfy exactOptionalPropertyTypes
  const updates: Parameters<typeof recordingsRepo.update>[1] = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.tags !== undefined) updates.tags = body.tags;

  const updated = recordingsRepo.update(id, updates);

  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update recording" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...updated,
    tags: recordingsRepo.parseTags(updated.tags),
  });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = recordingsRepo.findById(id);

  if (!existing || existing.userId !== user.id) {
    return NextResponse.json(
      { error: "Recording not found" },
      { status: 404 },
    );
  }

  // Delete recording + related data in a single transaction
  recordingsRepo.deleteCascade(id);

  // Delete OSS object (best-effort, don't fail the request)
  if (existing.ossKey) {
    deleteObject(existing.ossKey).catch(() => {
      // Log but don't block the response
      console.warn(`Failed to delete OSS object: ${existing.ossKey}`);
    });
  }

  return NextResponse.json({ deleted: true });
}
