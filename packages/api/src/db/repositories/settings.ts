/**
 * Settings repository factory.
 *
 * Settings are key-value pairs scoped per user.
 * Composite primary key: (user_id, key).
 */

import { and, eq } from "drizzle-orm";
import { rowsAffected } from "../drivers/result";
import { type DbSetting, settings } from "../schema";
import type { LyreDb } from "../types";

export function makeSettingsRepo(db: LyreDb) {
	const repo = {
		async findByUserId(userId: string): Promise<DbSetting[]> {
			return await db.select().from(settings).where(eq(settings.userId, userId)).all();
		},

		async findByKey(userId: string, key: string): Promise<DbSetting | undefined> {
			return await db
				.select()
				.from(settings)
				.where(and(eq(settings.userId, userId), eq(settings.key, key)))
				.get();
		},

		async upsert(userId: string, key: string, value: string): Promise<DbSetting> {
			const existing = await repo.findByKey(userId, key);
			if (existing) {
				await db
					.update(settings)
					.set({ value, updatedAt: Date.now() })
					.where(and(eq(settings.userId, userId), eq(settings.key, key)))
					.run();
				const updated = await repo.findByKey(userId, key);
				if (updated === undefined) {
					throw new Error("Settings row disappeared after update");
				}
				return updated;
			}
			return await db
				.insert(settings)
				.values({ userId, key, value, updatedAt: Date.now() })
				.returning()
				.get();
		},

		async delete(userId: string, key: string): Promise<boolean> {
			const result = await db
				.delete(settings)
				.where(and(eq(settings.userId, userId), eq(settings.key, key)))
				.run();
			return rowsAffected(result) > 0;
		},

		async deleteByUserId(userId: string): Promise<number> {
			const result = await db.delete(settings).where(eq(settings.userId, userId)).run();
			return rowsAffected(result);
		},

		async findByKeyAndValue(key: string, value: string): Promise<DbSetting | undefined> {
			return await db
				.select()
				.from(settings)
				.where(and(eq(settings.key, key), eq(settings.value, value)))
				.get();
		},
	};

	return repo;
}

export type SettingsRepo = ReturnType<typeof makeSettingsRepo>;
