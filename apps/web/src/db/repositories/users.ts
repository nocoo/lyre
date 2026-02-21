/**
 * User repository.
 *
 * Handles CRUD operations for the users table.
 * Users are created/upserted during OAuth sign-in.
 */

import { eq } from "drizzle-orm";
import { db } from "../index";
import { users, type DbUser } from "../schema";

export const usersRepo = {
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
      .values({
        ...data,
        createdAt: now,
        updatedAt: now,
      })
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

  /**
   * Upsert a user by email.
   * If the user exists, update name and avatar; otherwise create.
   * Used during OAuth sign-in.
   */
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
