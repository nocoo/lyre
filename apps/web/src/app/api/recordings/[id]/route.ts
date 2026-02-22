import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import {
  recordingsRepo,
  transcriptionsRepo,
  jobsRepo,
  foldersRepo,
  tagsRepo,
} from "@/db/repositories";
import { deleteObject, listObjects, deleteObjects } from "@/services/oss";
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
    folder: recording.folderId
      ? foldersRepo.findById(recording.folderId) ?? null
      : null,
    resolvedTags: tagsRepo.findTagsForRecording(id),
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
    notes?: string | null;
    folderId?: string | null;
    recordedAt?: number | null;
    tagIds?: string[];
  };

  // Build update object, omitting undefined fields to satisfy exactOptionalPropertyTypes
  const updates: Parameters<typeof recordingsRepo.update>[1] = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.folderId !== undefined) updates.folderId = body.folderId;
  if (body.recordedAt !== undefined) updates.recordedAt = body.recordedAt;

  const updated = recordingsRepo.update(id, updates);

  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update recording" },
      { status: 500 },
    );
  }

  // Update tag associations if tagIds provided
  if (body.tagIds !== undefined) {
    tagsRepo.setTagsForRecording(id, body.tagIds);
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

  // Collect job IDs before cascade-deleting DB records
  const jobs = jobsRepo.findByRecordingId(id);
  const jobIds = jobs.map((j) => j.id);

  // Delete recording + related data in a single transaction
  recordingsRepo.deleteCascade(id);

  // Delete OSS upload object (best-effort, don't fail the request)
  if (existing.ossKey) {
    deleteObject(existing.ossKey).catch(() => {
      console.warn(`Failed to delete OSS object: ${existing.ossKey}`);
    });
  }

  // Delete OSS result objects for all associated jobs (best-effort)
  for (const jobId of jobIds) {
    cleanupResultObjects(jobId).catch(() => {
      console.warn(`Failed to delete OSS result objects for job: ${jobId}`);
    });
  }

  return NextResponse.json({ deleted: true });
}

/**
 * Delete all OSS objects under results/{jobId}/.
 * Lists then batch-deletes to handle any number of result files.
 */
async function cleanupResultObjects(jobId: string): Promise<void> {
  const prefix = `results/${jobId}/`;
  const objects = await listObjects(prefix);
  if (objects.length === 0) return;
  await deleteObjects(objects.map((o) => o.key));
}
