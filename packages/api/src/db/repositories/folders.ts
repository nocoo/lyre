/**
 * Folder repository factory.
 */

import { eq, and, desc } from "drizzle-orm";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { folders, type DbFolder } from "../schema";

export function makeFoldersRepo(db: LyreDb) {
  return {
    async findByUserId(userId: string): Promise<DbFolder[]> {
      return await db
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
        .orderBy(desc(folders.createdAt))
        .all();
    },

    async findById(id: string): Promise<DbFolder | undefined> {
      return await db.select().from(folders).where(eq(folders.id, id)).get();
    },

    async findByIdAndUser(
      id: string,
      userId: string,
    ): Promise<DbFolder | undefined> {
      return await db
        .select()
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.userId, userId)))
        .get();
    },

    async create(data: {
      id: string;
      userId: string;
      name: string;
      icon?: string;
    }): Promise<DbFolder> {
      const now = Date.now();
      return await db
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

    async update(
      id: string,
      data: Partial<{ name: string; icon: string }>,
    ): Promise<DbFolder | undefined> {
      return await db
        .update(folders)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(folders.id, id))
        .returning()
        .get();
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(folders).where(eq(folders.id, id)).run();
      return rowsAffected(result) > 0;
    },
  };
}

export type FoldersRepo = ReturnType<typeof makeFoldersRepo>;

