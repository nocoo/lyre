/**
 * Recording repository factory.
 *
 * Tags are managed via the normalized tags + recording_tags tables.
 */

import { eq, desc } from "drizzle-orm";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { runBatch } from "../drivers/batch";
import {
  recordings,
  transcriptions,
  transcriptionJobs,
  recordingTags,
  type DbRecording,
} from "../schema";
import type { RecordingStatus } from "../../lib/types";

export function makeRecordingsRepo(db: LyreDb) {
  const repo = {
    async findAll(userId: string): Promise<DbRecording[]> {
      return await db
        .select()
        .from(recordings)
        .where(eq(recordings.userId, userId))
        .orderBy(desc(recordings.createdAt))
        .all();
    },

    async findById(id: string): Promise<DbRecording | undefined> {
      return await db
        .select()
        .from(recordings)
        .where(eq(recordings.id, id))
        .get();
    },

    async findByUserId(
      userId: string,
      options?: {
        status?: RecordingStatus;
        query?: string;
        folderId?: string | null;
        sortBy?: "createdAt" | "title" | "duration" | "fileSize";
        sortDir?: "asc" | "desc";
        page?: number;
        pageSize?: number;
      },
    ): Promise<{ items: DbRecording[]; total: number }> {
      const status = options?.status;
      const query = options?.query?.toLowerCase();
      const folderId = options?.folderId;
      const sortBy = options?.sortBy ?? "createdAt";
      const sortDir = options?.sortDir ?? "desc";
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? 10;

      let allRows: DbRecording[] = await db
        .select()
        .from(recordings)
        .where(eq(recordings.userId, userId))
        .all();

      if (status) {
        allRows = allRows.filter((r) => r.status === status);
      }

      if (folderId !== undefined) {
        if (folderId === null) {
          allRows = allRows.filter((r) => r.folderId === null);
        } else {
          allRows = allRows.filter((r) => r.folderId === folderId);
        }
      }

      if (query) {
        allRows = allRows.filter((r) => {
          const titleMatch = r.title.toLowerCase().includes(query);
          const descMatch =
            r.description?.toLowerCase().includes(query) ?? false;
          const summaryMatch =
            r.aiSummary?.toLowerCase().includes(query) ?? false;
          return titleMatch || descMatch || summaryMatch;
        });
      }

      const sortFn = (a: DbRecording, b: DbRecording): number => {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortBy) {
          case "title":
            return dir * a.title.localeCompare(b.title);
          case "createdAt":
            return dir * (a.createdAt - b.createdAt);
          case "duration":
            return dir * ((a.duration ?? 0) - (b.duration ?? 0));
          case "fileSize":
            return dir * ((a.fileSize ?? 0) - (b.fileSize ?? 0));
        }
      };
      allRows.sort(sortFn);

      const total = allRows.length;
      const offset = (page - 1) * pageSize;
      const items = allRows.slice(offset, offset + pageSize);

      return { items, total };
    },

    async create(data: {
      id: string;
      userId: string;
      title: string;
      description: string | null;
      fileName: string;
      fileSize: number | null;
      duration: number | null;
      format: string | null;
      sampleRate: number | null;
      ossKey: string;
      status: RecordingStatus;
      folderId?: string | null;
      notes?: string | null;
      recordedAt?: number | null;
    }): Promise<DbRecording> {
      const now = Date.now();
      return await db
        .insert(recordings)
        .values({
          ...data,
          tags: "[]",
          folderId: data.folderId ?? null,
          notes: data.notes ?? null,
          recordedAt: data.recordedAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },

    async update(
      id: string,
      data: Partial<{
        title: string;
        description: string | null;
        status: RecordingStatus;
        duration: number | null;
        fileSize: number | null;
        folderId: string | null;
        notes: string | null;
        aiSummary: string | null;
        recordedAt: number | null;
      }>,
    ): Promise<DbRecording | undefined> {
      const updateData: Record<string, unknown> = { updatedAt: Date.now() };
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.duration !== undefined) updateData.duration = data.duration;
      if (data.fileSize !== undefined) updateData.fileSize = data.fileSize;
      if (data.folderId !== undefined) updateData.folderId = data.folderId;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.aiSummary !== undefined) updateData.aiSummary = data.aiSummary;
      if (data.recordedAt !== undefined)
        updateData.recordedAt = data.recordedAt;

      return await db
        .update(recordings)
        .set(updateData)
        .where(eq(recordings.id, id))
        .returning()
        .get();
    },

    async delete(id: string): Promise<boolean> {
      const result = await db
        .delete(recordings)
        .where(eq(recordings.id, id))
        .run();
      return rowsAffected(result) > 0;
    },

    async deleteCascade(id: string): Promise<boolean> {
      // Pre-check existence so we can report whether the cascade actually
      // deleted anything; D1's batch result doesn't expose per-statement
      // changes in a uniform way across drivers.
      const existed = await repo.findById(id);
      if (!existed) return false;
      await runBatch(db, (h) => [
        h.delete(transcriptions).where(eq(transcriptions.recordingId, id)),
        h
          .delete(transcriptionJobs)
          .where(eq(transcriptionJobs.recordingId, id)),
        h.delete(recordingTags).where(eq(recordingTags.recordingId, id)),
        h.delete(recordings).where(eq(recordings.id, id)),
      ]);
      return true;
    },

    async deleteCascadeMany(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      // Filter to existing IDs so the returned count reflects actual deletes.
      const existingRows: DbRecording[] = await Promise.all(
        ids.map((id) => repo.findById(id)),
      ).then((rows) => rows.filter((r): r is DbRecording => !!r));
      const existingIds = existingRows.map((r) => r.id);
      if (existingIds.length === 0) return 0;
      await runBatch(db, (h) => {
        const stmts = [];
        for (const id of existingIds) {
          stmts.push(
            h.delete(transcriptions).where(eq(transcriptions.recordingId, id)),
            h
              .delete(transcriptionJobs)
              .where(eq(transcriptionJobs.recordingId, id)),
            h.delete(recordingTags).where(eq(recordingTags.recordingId, id)),
            h.delete(recordings).where(eq(recordings.id, id)),
          );
        }
        return stmts;
      });
      return existingIds.length;
    },
  };

  return repo;
}

export type RecordingsRepo = ReturnType<typeof makeRecordingsRepo>;

