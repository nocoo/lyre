/**
 * Settings repository factory.
 *
 * Settings are key-value pairs scoped per user.
 * Composite primary key: (user_id, key).
 */

import { eq, and } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { settings, type DbSetting } from "../schema";

export function makeSettingsRepo(db: LyreDb) {
  const repo = {
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

    upsert(userId: string, key: string, value: string): DbSetting {
      const existing = repo.findByKey(userId, key);
      if (existing) {
        db.update(settings)
          .set({ value, updatedAt: Date.now() })
          .where(and(eq(settings.userId, userId), eq(settings.key, key)))
          .run();
        return repo.findByKey(userId, key)!;
      }
      return db
        .insert(settings)
        .values({ userId, key, value, updatedAt: Date.now() })
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

    findByKeyAndValue(key: string, value: string): DbSetting | undefined {
      return db
        .select()
        .from(settings)
        .where(and(eq(settings.key, key), eq(settings.value, value)))
        .get();
    },
  };

  return repo;
}

export type SettingsRepo = ReturnType<typeof makeSettingsRepo>;

export const settingsRepo: SettingsRepo = makeSettingsRepo(defaultDb);
