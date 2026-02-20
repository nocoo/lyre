/**
 * Recording repository.
 *
 * Handles CRUD operations for the recordings table.
 * Tags are stored as JSON arrays in the database.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../index";
import { recordings, transcriptions, transcriptionJobs, type DbRecording } from "../schema";
import type { RecordingStatus } from "@/lib/types";

/** Parse tags JSON string to array */
function parseTags(tagsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Convert DB row to domain shape (parse tags) */
function toDomain(row: DbRecording): DbRecording & { parsedTags: string[] } {
  return { ...row, parsedTags: parseTags(row.tags) };
}

export const recordingsRepo = {
  findAll(userId: string): DbRecording[] {
    return db
      .select()
      .from(recordings)
      .where(eq(recordings.userId, userId))
      .orderBy(desc(recordings.createdAt))
      .all();
  },

  findById(id: string): DbRecording | undefined {
    return db.select().from(recordings).where(eq(recordings.id, id)).get();
  },

  findByUserId(
    userId: string,
    options?: {
      status?: RecordingStatus;
      query?: string;
      sortBy?: "createdAt" | "title" | "duration" | "fileSize";
      sortDir?: "asc" | "desc";
      page?: number;
      pageSize?: number;
    },
  ): { items: DbRecording[]; total: number } {
    const status = options?.status;
    const query = options?.query?.toLowerCase();
    const sortBy = options?.sortBy ?? "createdAt";
    const sortDir = options?.sortDir ?? "desc";
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 10;

    // Build conditions
    let allRows: DbRecording[] = db
      .select()
      .from(recordings)
      .where(eq(recordings.userId, userId))
      .all();

    // Filter by status
    if (status) {
      allRows = allRows.filter((r) => r.status === status);
    }

    // Filter by query (title, description, tags)
    if (query) {
      allRows = allRows.filter((r) => {
        const titleMatch = r.title.toLowerCase().includes(query);
        const descMatch = r.description?.toLowerCase().includes(query) ?? false;
        const tagsMatch = parseTags(r.tags).some((t) =>
          t.toLowerCase().includes(query),
        );
        return titleMatch || descMatch || tagsMatch;
      });
    }

    // Sort
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

  create(data: {
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
    tags: string[];
    status: RecordingStatus;
  }): DbRecording {
    const now = Date.now();
    return db
      .insert(recordings)
      .values({
        ...data,
        tags: JSON.stringify(data.tags),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  },

  update(
    id: string,
    data: Partial<{
      title: string;
      description: string | null;
      tags: string[];
      status: RecordingStatus;
      duration: number | null;
      fileSize: number | null;
    }>,
  ): DbRecording | undefined {
    const updateData: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.duration !== undefined) updateData.duration = data.duration;
    if (data.fileSize !== undefined) updateData.fileSize = data.fileSize;

    return db
      .update(recordings)
      .set(updateData)
      .where(eq(recordings.id, id))
      .returning()
      .get();
  },

  delete(id: string): boolean {
    const result = db
      .delete(recordings)
      .where(eq(recordings.id, id))
      .run() as unknown as { changes: number };
    return result.changes > 0;
  },

  /**
   * Delete a recording and all related transcriptions/jobs in a single transaction.
   * Returns true if the recording was deleted.
   */
  deleteCascade(id: string): boolean {
    return db.transaction((tx: typeof db) => {
      tx.delete(transcriptions)
        .where(eq(transcriptions.recordingId, id))
        .run();
      tx.delete(transcriptionJobs)
        .where(eq(transcriptionJobs.recordingId, id))
        .run();
      const result = tx
        .delete(recordings)
        .where(eq(recordings.id, id))
        .run() as unknown as { changes: number };
      return result.changes > 0;
    });
  },

  /** Helper: parse tags from a DB row */
  parseTags,

  /** Helper: convert DB row to domain shape */
  toDomain,
};
