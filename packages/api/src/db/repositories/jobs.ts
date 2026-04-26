/**
 * Transcription jobs repository factory.
 */

import { eq, desc, inArray } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { transcriptionJobs, type DbTranscriptionJob } from "../schema";
import type { JobStatus } from "../../lib/types";

export function makeJobsRepo(db: LyreDb) {
  return {
    async findById(id: string): Promise<DbTranscriptionJob | undefined> {
      return await db
        .select()
        .from(transcriptionJobs)
        .where(eq(transcriptionJobs.id, id))
        .get();
    },

    async findByTaskId(
      taskId: string,
    ): Promise<DbTranscriptionJob | undefined> {
      return await db
        .select()
        .from(transcriptionJobs)
        .where(eq(transcriptionJobs.taskId, taskId))
        .get();
    },

    async findLatestByRecordingId(
      recordingId: string,
    ): Promise<DbTranscriptionJob | undefined> {
      return await db
        .select()
        .from(transcriptionJobs)
        .where(eq(transcriptionJobs.recordingId, recordingId))
        .orderBy(desc(transcriptionJobs.createdAt))
        .get();
    },

    async findByRecordingId(
      recordingId: string,
    ): Promise<DbTranscriptionJob[]> {
      return await db
        .select()
        .from(transcriptionJobs)
        .where(eq(transcriptionJobs.recordingId, recordingId))
        .orderBy(desc(transcriptionJobs.createdAt))
        .all();
    },

    async create(data: {
      id: string;
      recordingId: string;
      taskId: string;
      requestId: string | null;
      status: JobStatus;
    }): Promise<DbTranscriptionJob> {
      const now = Date.now();
      return await db
        .insert(transcriptionJobs)
        .values({ ...data, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    async update(
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
    ): Promise<DbTranscriptionJob | undefined> {
      return await db
        .update(transcriptionJobs)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(transcriptionJobs.id, id))
        .returning()
        .get();
    },

    async delete(id: string): Promise<boolean> {
      const result = await db
        .delete(transcriptionJobs)
        .where(eq(transcriptionJobs.id, id))
        .run();
      return rowsAffected(result) > 0;
    },

    async deleteByRecordingId(recordingId: string): Promise<number> {
      const result = await db
        .delete(transcriptionJobs)
        .where(eq(transcriptionJobs.recordingId, recordingId))
        .run();
      return rowsAffected(result);
    },

    async findActive(): Promise<DbTranscriptionJob[]> {
      return await db
        .select()
        .from(transcriptionJobs)
        .where(inArray(transcriptionJobs.status, ["PENDING", "RUNNING"]))
        .orderBy(desc(transcriptionJobs.createdAt))
        .all();
    },
  };
}

export type JobsRepo = ReturnType<typeof makeJobsRepo>;

export const jobsRepo: JobsRepo = makeJobsRepo(defaultDb);
