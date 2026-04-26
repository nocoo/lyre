/**
 * Tag repository factory.
 *
 * Tags are user-scoped; each user has their own tag library.
 */

import { eq, and, inArray } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { tags, recordingTags, type DbTag } from "../schema";

export function makeTagsRepo(db: LyreDb) {
  const repo = {
    findByUserId(userId: string): DbTag[] {
      return db.select().from(tags).where(eq(tags.userId, userId)).all();
    },

    findById(id: string): DbTag | undefined {
      return db.select().from(tags).where(eq(tags.id, id)).get();
    },

    findByIdAndUser(id: string, userId: string): DbTag | undefined {
      return db
        .select()
        .from(tags)
        .where(and(eq(tags.id, id), eq(tags.userId, userId)))
        .get();
    },

    findByNameAndUser(name: string, userId: string): DbTag | undefined {
      return db
        .select()
        .from(tags)
        .where(and(eq(tags.name, name), eq(tags.userId, userId)))
        .get();
    },

    create(data: { id: string; userId: string; name: string }): DbTag {
      const now = Date.now();
      return db
        .insert(tags)
        .values({ ...data, createdAt: now })
        .returning()
        .get();
    },

    delete(id: string): boolean {
      const result = db
        .delete(tags)
        .where(eq(tags.id, id))
        .run() as unknown as { changes: number };
      return result.changes > 0;
    },

    update(id: string, data: { name: string }): DbTag | undefined {
      const rows = db
        .update(tags)
        .set({ name: data.name })
        .where(eq(tags.id, id))
        .returning()
        .all();
      return rows[0];
    },

    findTagIdsForRecording(recordingId: string): string[] {
      const rows = db
        .select({ tagId: recordingTags.tagId })
        .from(recordingTags)
        .where(eq(recordingTags.recordingId, recordingId))
        .all();
      return rows.map((r: { tagId: string }) => r.tagId);
    },

    findTagsForRecording(recordingId: string): DbTag[] {
      const tagIds = repo.findTagIdsForRecording(recordingId);
      if (tagIds.length === 0) return [];
      return db.select().from(tags).where(inArray(tags.id, tagIds)).all();
    },

    setTagsForRecording(recordingId: string, tagIds: string[]): void {
      db.transaction((tx: LyreDb) => {
        tx.delete(recordingTags)
          .where(eq(recordingTags.recordingId, recordingId))
          .run();
        for (const tagId of tagIds) {
          tx.insert(recordingTags).values({ recordingId, tagId }).run();
        }
      });
    },

    clearTagsForRecording(recordingId: string): void {
      db.delete(recordingTags)
        .where(eq(recordingTags.recordingId, recordingId))
        .run();
    },
  };

  return repo;
}

export type TagsRepo = ReturnType<typeof makeTagsRepo>;

export const tagsRepo: TagsRepo = makeTagsRepo(defaultDb);
