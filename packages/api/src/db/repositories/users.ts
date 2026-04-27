/**
 * User repository factory.
 *
 * `makeUsersRepo(db)` returns a repository bound to the given Drizzle
 * handle (D1 in production, in-memory SQLite in tests).
 */

import { eq } from "drizzle-orm";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { users, type DbUser } from "../schema";

export function makeUsersRepo(db: LyreDb) {
  return {
    async findAll(): Promise<DbUser[]> {
      return await db.select().from(users).all();
    },

    async findById(id: string): Promise<DbUser | undefined> {
      return await db.select().from(users).where(eq(users.id, id)).get();
    },

    async findByEmail(email: string): Promise<DbUser | undefined> {
      return await db.select().from(users).where(eq(users.email, email)).get();
    },

    async create(data: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    }): Promise<DbUser> {
      const now = Date.now();
      return await db
        .insert(users)
        .values({ ...data, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    async update(
      id: string,
      data: Partial<{ name: string | null; avatarUrl: string | null }>,
    ): Promise<DbUser | undefined> {
      return await db
        .update(users)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(users.id, id))
        .returning()
        .get();
    },

    async upsertByEmail(data: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    }): Promise<DbUser> {
      const existing = await this.findByEmail(data.email);
      if (existing) {
        return (await this.update(existing.id, {
          name: data.name,
          avatarUrl: data.avatarUrl,
        }))!;
      }
      return await this.create(data);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(users).where(eq(users.id, id)).run();
      return rowsAffected(result) > 0;
    },
  };
}

export type UsersRepo = ReturnType<typeof makeUsersRepo>;

