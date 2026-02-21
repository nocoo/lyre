/**
 * Device tokens repository.
 *
 * Handles CRUD for the device_tokens table.
 * Tokens allow programmatic API access from external devices (e.g. macOS app).
 * The raw token is never stored — only its SHA-256 hash.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../index";
import { deviceTokens, type DbDeviceToken } from "../schema";

export const deviceTokensRepo = {
  /** Find a token record by its SHA-256 hash (for auth lookup). */
  findByHash(tokenHash: string): DbDeviceToken | undefined {
    return db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.tokenHash, tokenHash))
      .get();
  },

  /** Find a token by ID (for deletion). */
  findById(id: string): DbDeviceToken | undefined {
    return db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.id, id))
      .get();
  },

  /** List all tokens for a user (for settings UI). */
  findByUserId(userId: string): DbDeviceToken[] {
    return db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId))
      .all();
  },

  /** Create a new token record (hash must be pre-computed). */
  create(data: {
    id: string;
    userId: string;
    name: string;
    tokenHash: string;
  }): DbDeviceToken {
    return db
      .insert(deviceTokens)
      .values({
        ...data,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  },

  /** Update lastUsedAt timestamp (called on each authenticated request). */
  touchLastUsed(id: string): void {
    db.update(deviceTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(deviceTokens.id, id))
      .run();
  },

  /** Delete a token by ID, scoped to a user (for revocation). */
  deleteByIdAndUser(id: string, userId: string): boolean {
    const result = db
      .delete(deviceTokens)
      .where(
        and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)),
      )
      .run() as unknown as { changes: number };
    return result.changes > 0;
  },

  /** Delete all tokens for a user. */
  deleteByUserId(userId: string): number {
    const result = db
      .delete(deviceTokens)
      .where(eq(deviceTokens.userId, userId))
      .run() as unknown as { changes: number };
    return result.changes;
  },
};
