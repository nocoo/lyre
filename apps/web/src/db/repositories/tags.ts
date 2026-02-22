/**
 * Tag repository.
 *
 * Handles CRUD for the tags table and the recording_tags join table.
 * Tags are user-scoped; each user has their own tag library.
 */

import { eq, and, inArray } from "drizzle-orm";
import { db } from "../index";
import { tags, recordingTags, type DbTag } from "../schema";

export const tagsRepo = {
  /** List all tags for a user */
  findByUserId(userId: string): DbTag[] {
    return db
      .select()
      .from(tags)
      .where(eq(tags.userId, userId))
      .all();
  },

  findById(id: string): DbTag | undefined {
    return db.select().from(tags).where(eq(tags.id, id)).get();
  },

  /** Find a tag belonging to a specific user */
  findByIdAndUser(id: string, userId: string): DbTag | undefined {
    return db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .get();
  },

  /** Find a tag by name for a specific user (case-sensitive) */
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

  /** Rename a tag */
  update(id: string, data: { name: string }): DbTag | undefined {
    const rows = db
      .update(tags)
      .set({ name: data.name })
      .where(eq(tags.id, id))
      .returning()
      .all();
    return rows[0];
  },

  // ── Recording ↔ Tag join operations ──

  /** Get all tag IDs for a recording */
  findTagIdsForRecording(recordingId: string): string[] {
    const rows = db
      .select({ tagId: recordingTags.tagId })
      .from(recordingTags)
      .where(eq(recordingTags.recordingId, recordingId))
      .all();
    return rows.map((r: { tagId: string }) => r.tagId);
  },

  /** Get all tags for a recording (resolved) */
  findTagsForRecording(recordingId: string): DbTag[] {
    const tagIds = this.findTagIdsForRecording(recordingId);
    if (tagIds.length === 0) return [];
    return db
      .select()
      .from(tags)
      .where(inArray(tags.id, tagIds))
      .all();
  },

  /** Set the tags for a recording (replace all existing associations) */
  setTagsForRecording(recordingId: string, tagIds: string[]): void {
    db.transaction((tx: typeof db) => {
      // Remove all existing associations
      tx.delete(recordingTags)
        .where(eq(recordingTags.recordingId, recordingId))
        .run();

      // Insert new associations
      for (const tagId of tagIds) {
        tx.insert(recordingTags)
          .values({ recordingId, tagId })
          .run();
      }
    });
  },

  /** Remove all tag associations for a recording */
  clearTagsForRecording(recordingId: string): void {
    db.delete(recordingTags)
      .where(eq(recordingTags.recordingId, recordingId))
      .run();
  },
};
