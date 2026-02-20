/**
 * Transcription jobs repository.
 *
 * Handles CRUD for the transcription_jobs table.
 * Jobs track the async DashScope ASR processing status.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../index";
import { transcriptionJobs, type DbTranscriptionJob } from "../schema";
import type { JobStatus } from "@/lib/types";

export const jobsRepo = {
  findById(id: string): DbTranscriptionJob | undefined {
    return db
      .select()
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.id, id))
      .get();
  },

  findByTaskId(taskId: string): DbTranscriptionJob | undefined {
    return db
      .select()
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.taskId, taskId))
      .get();
  },

  /** Get the latest job for a recording */
  findLatestByRecordingId(
    recordingId: string,
  ): DbTranscriptionJob | undefined {
    return db
      .select()
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.recordingId, recordingId))
      .orderBy(desc(transcriptionJobs.createdAt))
      .get();
  },

  /** Get all jobs for a recording */
  findByRecordingId(recordingId: string): DbTranscriptionJob[] {
    return db
      .select()
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.recordingId, recordingId))
      .orderBy(desc(transcriptionJobs.createdAt))
      .all();
  },

  create(data: {
    id: string;
    recordingId: string;
    taskId: string;
    requestId: string | null;
    status: JobStatus;
  }): DbTranscriptionJob {
    const now = Date.now();
    return db
      .insert(transcriptionJobs)
      .values({
        ...data,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  },

  update(
    id: string,
    data: Partial<{
      status: JobStatus;
      requestId: string | null;
      submitTime: string | null;
      endTime: string | null;
      usageSeconds: number | null;
      errorMessage: string | null;
      resultUrl: string | null;
    }>,
  ): DbTranscriptionJob | undefined {
    return db
      .update(transcriptionJobs)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(transcriptionJobs.id, id))
      .returning()
      .get();
  },

  delete(id: string): boolean {
    const result = db
      .delete(transcriptionJobs)
      .where(eq(transcriptionJobs.id, id))
      .run() as unknown as { changes: number };
    return result.changes > 0;
  },

  deleteByRecordingId(recordingId: string): number {
    const result = db
      .delete(transcriptionJobs)
      .where(eq(transcriptionJobs.recordingId, recordingId))
      .run() as unknown as { changes: number };
    return result.changes;
  },
};
