/**
 * Device tokens repository factory.
 *
 * Tokens allow programmatic API access from external devices (e.g. macOS app).
 * The raw token is never stored — only its SHA-256 hash.
 */

import { eq, and } from "drizzle-orm";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { deviceTokens, type DbDeviceToken } from "../schema";

export function makeDeviceTokensRepo(db: LyreDb) {
  return {
    async findByHash(tokenHash: string): Promise<DbDeviceToken | undefined> {
      return await db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.tokenHash, tokenHash))
        .get();
    },

    async findById(id: string): Promise<DbDeviceToken | undefined> {
      return await db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.id, id))
        .get();
    },

    async findByUserId(userId: string): Promise<DbDeviceToken[]> {
      return await db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.userId, userId))
        .all();
    },

    async create(data: {
      id: string;
      userId: string;
      name: string;
      tokenHash: string;
    }): Promise<DbDeviceToken> {
      return await db
        .insert(deviceTokens)
        .values({ ...data, createdAt: Date.now() })
        .returning()
        .get();
    },

    async touchLastUsed(id: string): Promise<void> {
      await db
        .update(deviceTokens)
        .set({ lastUsedAt: Date.now() })
        .where(eq(deviceTokens.id, id))
        .run();
    },

    async deleteByIdAndUser(id: string, userId: string): Promise<boolean> {
      const result = await db
        .delete(deviceTokens)
        .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)))
        .run();
      return rowsAffected(result) > 0;
    },

    async deleteByUserId(userId: string): Promise<number> {
      const result = await db
        .delete(deviceTokens)
        .where(eq(deviceTokens.userId, userId))
        .run();
      return rowsAffected(result);
    },
  };
}

export type DeviceTokensRepo = ReturnType<typeof makeDeviceTokensRepo>;

