/**
 * Folder repository factory.
 */

import { eq, and, desc } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { folders, type DbFolder } from "../schema";

export function makeFoldersRepo(db: LyreDb) {
  return {
    findByUserId(userId: string): DbFolder[] {
      return db
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
        .orderBy(desc(folders.createdAt))
        .all();
    },

    findById(id: string): DbFolder | undefined {
      return db.select().from(folders).where(eq(folders.id, id)).get();
    },

    findByIdAndUser(id: string, userId: string): DbFolder | undefined {
      return db
        .select()
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.userId, userId)))
        .get();
    },

    create(data: {
      id: string;
      userId: string;
      name: string;
      icon?: string;
    }): DbFolder {
      const now = Date.now();
      return db
        .insert(folders)
        .values({
          id: data.id,
          userId: data.userId,
          name: data.name,
          icon: data.icon ?? "folder",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },

    update(
      id: string,
      data: Partial<{ name: string; icon: string }>,
    ): DbFolder | undefined {
      return db
        .update(folders)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(folders.id, id))
        .returning()
        .get();
    },

    delete(id: string): boolean {
      const result = db
        .delete(folders)
        .where(eq(folders.id, id))
        .run() as unknown as { changes: number };
      return result.changes > 0;
    },
  };
}

export type FoldersRepo = ReturnType<typeof makeFoldersRepo>;

export const foldersRepo: FoldersRepo = makeFoldersRepo(defaultDb);
