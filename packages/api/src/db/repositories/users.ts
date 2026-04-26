/**
 * User repository factory.
 *
 * `makeUsersRepo(db)` returns a repository bound to the given Drizzle
 * handle. The default `usersRepo` export wraps the legacy SQLite
 * singleton so existing call sites keep working — Wave B.6.b is
 * migrating handlers to call `makeUsersRepo(ctx.db)` per request.
 */

import { eq } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { users, type DbUser } from "../schema";

export function makeUsersRepo(db: LyreDb) {
  return {
    findAll(): DbUser[] {
      return db.select().from(users).all();
    },

    findById(id: string): DbUser | undefined {
      return db.select().from(users).where(eq(users.id, id)).get();
    },

    findByEmail(email: string): DbUser | undefined {
      return db.select().from(users).where(eq(users.email, email)).get();
    },

    create(data: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    }): DbUser {
      const now = Date.now();
      return db
        .insert(users)
        .values({ ...data, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    update(
      id: string,
      data: Partial<{ name: string | null; avatarUrl: string | null }>,
    ): DbUser | undefined {
      return db
        .update(users)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(users.id, id))
        .returning()
        .get();
    },

    upsertByEmail(data: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    }): DbUser {
      const existing = this.findByEmail(data.email);
      if (existing) {
        return this.update(existing.id, {
          name: data.name,
          avatarUrl: data.avatarUrl,
        })!;
      }
      return this.create(data);
    },

    delete(id: string): boolean {
      const result = db
        .delete(users)
        .where(eq(users.id, id))
        .run() as unknown as { changes: number };
      return result.changes > 0;
    },
  };
}

export type UsersRepo = ReturnType<typeof makeUsersRepo>;

export const usersRepo: UsersRepo = makeUsersRepo(defaultDb);
