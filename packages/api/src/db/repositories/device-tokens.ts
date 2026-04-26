/**
 * Device tokens repository factory.
 *
 * Tokens allow programmatic API access from external devices (e.g. macOS app).
 * The raw token is never stored — only its SHA-256 hash.
 */

import { eq, and } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { deviceTokens, type DbDeviceToken } from "../schema";

export function makeDeviceTokensRepo(db: LyreDb) {
  return {
    findByHash(tokenHash: string): DbDeviceToken | undefined {
      return db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.tokenHash, tokenHash))
        .get();
    },

    findById(id: string): DbDeviceToken | undefined {
      return db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.id, id))
        .get();
    },

    findByUserId(userId: string): DbDeviceToken[] {
      return db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.userId, userId))
        .all();
    },

    create(data: {
      id: string;
      userId: string;
      name: string;
      tokenHash: string;
    }): DbDeviceToken {
      return db
        .insert(deviceTokens)
        .values({ ...data, createdAt: Date.now() })
        .returning()
        .get();
    },

    touchLastUsed(id: string): void {
      db.update(deviceTokens)
        .set({ lastUsedAt: Date.now() })
        .where(eq(deviceTokens.id, id))
        .run();
    },

    deleteByIdAndUser(id: string, userId: string): boolean {
      const result = db
        .delete(deviceTokens)
        .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)))
        .run() as unknown as { changes: number };
      return result.changes > 0;
    },

    deleteByUserId(userId: string): number {
      const result = db
        .delete(deviceTokens)
        .where(eq(deviceTokens.userId, userId))
        .run() as unknown as { changes: number };
      return result.changes;
    },
  };
}

export type DeviceTokensRepo = ReturnType<typeof makeDeviceTokensRepo>;

export const deviceTokensRepo: DeviceTokensRepo =
  makeDeviceTokensRepo(defaultDb);
