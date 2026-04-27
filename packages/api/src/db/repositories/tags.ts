/**
 * Tag repository factory.
 *
 * Tags are user-scoped; each user has their own tag library.
 */

import { eq, and, inArray } from "drizzle-orm";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { runBatch } from "../drivers/batch";
import { tags, recordingTags, type DbTag } from "../schema";

export function makeTagsRepo(db: LyreDb) {
  const repo = {
    async findByUserId(userId: string): Promise<DbTag[]> {
      return await db.select().from(tags).where(eq(tags.userId, userId)).all();
    },

    async findById(id: string): Promise<DbTag | undefined> {
      return await db.select().from(tags).where(eq(tags.id, id)).get();
    },

    async findByIdAndUser(
      id: string,
      userId: string,
    ): Promise<DbTag | undefined> {
      return await db
        .select()
        .from(tags)
        .where(and(eq(tags.id, id), eq(tags.userId, userId)))
        .get();
    },

    async findByNameAndUser(
      name: string,
      userId: string,
    ): Promise<DbTag | undefined> {
      return await db
        .select()
        .from(tags)
        .where(and(eq(tags.name, name), eq(tags.userId, userId)))
        .get();
    },

    async create(data: {
      id: string;
      userId: string;
      name: string;
    }): Promise<DbTag> {
      const now = Date.now();
      return await db
        .insert(tags)
        .values({ ...data, createdAt: now })
        .returning()
        .get();
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(tags).where(eq(tags.id, id)).run();
      return rowsAffected(result) > 0;
    },

    async update(
      id: string,
      data: { name: string },
    ): Promise<DbTag | undefined> {
      const rows = await db
        .update(tags)
        .set({ name: data.name })
        .where(eq(tags.id, id))
        .returning()
        .all();
      return rows[0];
    },

    async findTagIdsForRecording(recordingId: string): Promise<string[]> {
      const rows = await db
        .select({ tagId: recordingTags.tagId })
        .from(recordingTags)
        .where(eq(recordingTags.recordingId, recordingId))
        .all();
      return rows.map((r: { tagId: string }) => r.tagId);
    },

    async findTagsForRecording(recordingId: string): Promise<DbTag[]> {
      const tagIds = await repo.findTagIdsForRecording(recordingId);
      if (tagIds.length === 0) return [];
      return await db
        .select()
        .from(tags)
        .where(inArray(tags.id, tagIds))
        .all();
    },

    async setTagsForRecording(
      recordingId: string,
      tagIds: string[],
    ): Promise<void> {
      await runBatch(db, (h) => {
        const stmts = [
          h
            .delete(recordingTags)
            .where(eq(recordingTags.recordingId, recordingId)),
        ];
        for (const tagId of tagIds) {
          stmts.push(h.insert(recordingTags).values({ recordingId, tagId }));
        }
        return stmts;
      });
    },

    async clearTagsForRecording(recordingId: string): Promise<void> {
      await db
        .delete(recordingTags)
        .where(eq(recordingTags.recordingId, recordingId))
        .run();
    },
  };

  return repo;
}

export type TagsRepo = ReturnType<typeof makeTagsRepo>;

