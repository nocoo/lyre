import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import {
  recordingsRepo,
  transcriptionsRepo,
  jobsRepo,
} from "@/db/repositories";
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

  const updated = recordingsRepo.update(id, {
    title: body.title,
    description: body.description,
    tags: body.tags,
  });

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

  // Delete in FK order: transcriptions → jobs → recording
  transcriptionsRepo.deleteByRecordingId(id);
  jobsRepo.deleteByRecordingId(id);
  recordingsRepo.delete(id);

  // TODO: Delete OSS object in Phase 5 when OSS is wired
  return NextResponse.json({ deleted: true });
}
