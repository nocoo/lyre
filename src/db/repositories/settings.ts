/**
 * Settings repository.
 *
 * Handles CRUD for the settings table.
 * Settings are key-value pairs scoped per user.
 * Composite primary key: (user_id, key).
 */

import { eq, and } from "drizzle-orm";
import { db } from "../index";
import { settings, type DbSetting } from "../schema";

export const settingsRepo = {
  findByUserId(userId: string): DbSetting[] {
    return db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .all();
  },

  findByKey(userId: string, key: string): DbSetting | undefined {
    return db
      .select()
      .from(settings)
      .where(and(eq(settings.userId, userId), eq(settings.key, key)))
      .get();
  },

  /**
   * Set a setting value. Creates or updates the entry.
   */
  upsert(userId: string, key: string, value: string): DbSetting {
    const existing = this.findByKey(userId, key);
    if (existing) {
      db.update(settings)
        .set({ value, updatedAt: Date.now() })
        .where(and(eq(settings.userId, userId), eq(settings.key, key)))
        .run();
      return this.findByKey(userId, key)!;
    }
    return db
      .insert(settings)
      .values({
        userId,
        key,
        value,
        updatedAt: Date.now(),
      })
      .returning()
      .get();
  },

  delete(userId: string, key: string): boolean {
    const result = db
      .delete(settings)
      .where(and(eq(settings.userId, userId), eq(settings.key, key)))
      .run() as unknown as { changes: number };
    return result.changes > 0;
  },

  deleteByUserId(userId: string): number {
    const result = db
      .delete(settings)
      .where(eq(settings.userId, userId))
      .run() as unknown as { changes: number };
    return result.changes;
  },
};
