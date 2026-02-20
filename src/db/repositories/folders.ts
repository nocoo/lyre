/**
 * Folder repository.
 *
 * Handles CRUD operations for the folders table.
 * Folders are flat (one level only) and user-scoped.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../index";
import { folders, type DbFolder } from "../schema";

export const foldersRepo = {
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

  /** Find a folder belonging to a specific user */
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
