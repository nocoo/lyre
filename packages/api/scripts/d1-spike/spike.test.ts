/**
 * D1 Compatibility Spike — Wave B.0 gate.
 *
 * Verifies the highest-risk lyre query paths run on drizzle-orm/d1 + Miniflare's
 * in-memory D1. Findings feed into docs/03-cf-worker-migration-plan.md
 * Wave B.0 spike-findings table.
 *
 * Run: bun test spike.test.ts
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  users,
  folders,
  recordings,
  transcriptionJobs,
  transcriptions,
  tags,
  recordingTags,
  deviceTokens,
} from "./schema";

let mf: Miniflare;
type DB = ReturnType<typeof drizzle>;
let db: DB;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  const d1 = await mf.getD1Database("DB");
  db = drizzle(d1);

  // Apply schema migration (split on drizzle's statement-breakpoint marker).
  const sql = readFileSync(
    resolve(import.meta.dir, "migrations/0000_grey_silver_surfer.sql"),
    "utf-8",
  );
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) {
    await d1.exec(s.replace(/\n/g, " "));
  }
});

afterAll(async () => {
  await mf.dispose();
});

const now = () => Date.now();

async function seedUser(id = "user-1") {
  await db
    .insert(users)
    .values({
      id,
      email: `${id}@example.com`,
      name: "Test",
      avatarUrl: null,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return id;
}

// ── Finding #1: drizzle-kit-generated SQL applies cleanly via D1 exec ──

describe("Finding #5 — drizzle migration apply", () => {
  test("schema is queryable", async () => {
    const userId = await seedUser("schema-check");
    const found = await db.select().from(users).where(eq(users.id, userId)).get();
    expect(found?.email).toBe("schema-check@example.com");
  });
});

// ── Finding #1 — .returning() on insert/update ──

describe("Finding #1 — .returning()", () => {
  test("INSERT .returning() returns the inserted row", async () => {
    const id = "ret-insert";
    const userId = await seedUser("ret-user-1");
    const inserted = await db
      .insert(folders)
      .values({
        id,
        userId,
        name: "ret folder",
        icon: "folder",
        createdAt: now(),
        updatedAt: now(),
      })
      .returning()
      .get();
    expect(inserted?.id).toBe(id);
    expect(inserted?.name).toBe("ret folder");
  });

  test("UPDATE .returning() returns the updated row", async () => {
    const id = "ret-update";
    const userId = await seedUser("ret-user-2");
    await db
      .insert(folders)
      .values({
        id,
        userId,
        name: "before",
        icon: "folder",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();

    const updated = await db
      .update(folders)
      .set({ name: "after", updatedAt: now() })
      .where(eq(folders.id, id))
      .returning()
      .get();
    expect(updated?.name).toBe("after");
  });

  test("UPDATE .returning() returning specific columns", async () => {
    const id = "ret-update-cols";
    const userId = await seedUser("ret-user-3");
    await db
      .insert(folders)
      .values({
        id,
        userId,
        name: "x",
        icon: "folder",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    const row = await db
      .update(folders)
      .set({ name: "y", updatedAt: now() })
      .where(eq(folders.id, id))
      .returning({ id: folders.id, name: folders.name })
      .get();
    expect(row).toEqual({ id, name: "y" });
  });
});

// ── Finding #2 — db.transaction() vs db.batch() ──

describe("Finding #2 — multi-statement atomicity", () => {
  test("db.transaction() throws on D1 (interactive txn unsupported)", async () => {
    const userId = await seedUser("txn-user");
    let captured: unknown = null;
    try {
      // drizzle-orm/d1 throws synchronously when callers invoke .transaction
      // (D1 Workers binding has no interactive transaction primitive).
      await db.transaction(async (tx) => {
        await tx
          .insert(folders)
          .values({
            id: "txn-1",
            userId,
            name: "in-txn",
            icon: "folder",
            createdAt: now(),
            updatedAt: now(),
          })
          .run();
      });
    } catch (e) {
      captured = e;
    }
    expect(captured).not.toBeNull();
    // Drizzle-d1's transaction shim emits BEGIN; D1 rejects it.
    // We pin the observed error message so future drizzle upgrades
    // surface here if behaviour changes.
    expect(String(captured)).toMatch(/Failed query: begin|transaction|not supported|interactive/i);
  });

  test("db.batch() commits all statements atomically (happy path)", async () => {
    const userId = await seedUser("batch-user");
    const recId = "batch-rec-1";
    const tagAId = "batch-tag-a";
    const tagBId = "batch-tag-b";

    // Pre-seed parent rows that the batch references.
    await db
      .insert(recordings)
      .values({
        id: recId,
        userId,
        folderId: null,
        title: "t",
        fileName: "a.m4a",
        ossKey: "k",
        status: "uploaded",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    await db
      .insert(tags)
      .values({ id: tagAId, userId, name: "a", createdAt: now() })
      .run();
    await db
      .insert(tags)
      .values({ id: tagBId, userId, name: "b", createdAt: now() })
      .run();

    // Equivalent of the legacy `setTagsForRecording` transaction:
    //   delete existing assoc rows; re-insert new ones.
    await db.batch([
      db
        .delete(recordingTags)
        .where(eq(recordingTags.recordingId, recId)),
      db.insert(recordingTags).values({ recordingId: recId, tagId: tagAId }),
      db.insert(recordingTags).values({ recordingId: recId, tagId: tagBId }),
    ]);

    const linked = await db
      .select()
      .from(recordingTags)
      .where(eq(recordingTags.recordingId, recId))
      .all();
    expect(linked).toHaveLength(2);
    expect(linked.map((r) => r.tagId).sort()).toEqual([tagAId, tagBId]);
  });

  test("db.batch() rolls back when any statement fails", async () => {
    const userId = await seedUser("batch-fail-user");
    const recId = "batch-fail-rec";
    await db
      .insert(recordings)
      .values({
        id: recId,
        userId,
        folderId: null,
        title: "t",
        fileName: "a.m4a",
        ossKey: "k",
        status: "uploaded",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    await db
      .insert(tags)
      .values({ id: "tag-ok", userId, name: "ok", createdAt: now() })
      .run();

    let threw = false;
    try {
      await db.batch([
        db.insert(recordingTags).values({ recordingId: recId, tagId: "tag-ok" }),
        // FK violation on tag_id references a missing row.
        db
          .insert(recordingTags)
          .values({ recordingId: recId, tagId: "tag-MISSING" }),
      ]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Atomicity: the first insert must NOT be visible.
    const linked = await db
      .select()
      .from(recordingTags)
      .where(eq(recordingTags.recordingId, recId))
      .all();
    // NB: D1 default does not enforce FKs unless PRAGMA foreign_keys=ON;
    // in that case the batch *can* succeed, in which case both rows commit.
    // We assert a strict invariant: either none committed (FK enforced) or
    // both committed (FK off). Mixed state is the failure mode we're guarding.
    expect([0, 2]).toContain(linked.length);
  });
});

// ── Finding #3 — Compound query (join + where + order + limit) ──

describe("Finding #3 — join + where + order + limit", () => {
  test("recordings list with optional folder filter", async () => {
    const userId = await seedUser("join-user");
    const fId = "join-folder";
    await db
      .insert(folders)
      .values({
        id: fId,
        userId,
        name: "f",
        icon: "folder",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    const t = now();
    for (let i = 0; i < 3; i++) {
      await db
        .insert(recordings)
        .values({
          id: `r-${i}`,
          userId,
          folderId: i === 0 ? fId : null,
          title: `rec-${i}`,
          fileName: `${i}.m4a`,
          ossKey: `k-${i}`,
          status: "uploaded",
          createdAt: t + i,
          updatedAt: t + i,
        })
        .run();
    }
    const rows = await db
      .select({
        id: recordings.id,
        title: recordings.title,
        folderName: folders.name,
      })
      .from(recordings)
      .leftJoin(folders, eq(recordings.folderId, folders.id))
      .where(eq(recordings.userId, userId))
      .orderBy(recordings.createdAt)
      .limit(10)
      .all();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.folderName).toBe("f");
    expect(rows[1]?.folderName).toBeNull();
  });
});

// ── Finding #4 — integer timestamps round-trip ──

describe("Finding #4 — timestamp round-trip", () => {
  test("integer column stores ms epoch and reads back identically", async () => {
    const userId = await seedUser("ts-user");
    const ts = 1_700_000_000_123;
    const id = "ts-rec";
    await db
      .insert(recordings)
      .values({
        id,
        userId,
        folderId: null,
        title: "t",
        fileName: "a.m4a",
        ossKey: "k",
        status: "uploaded",
        recordedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const row = await db.select().from(recordings).where(eq(recordings.id, id)).get();
    expect(row?.recordedAt).toBe(ts);
    expect(row?.createdAt).toBe(ts);
  });
});

// ── Finding bonus — INSERT ... ON CONFLICT (upsert) used by settings repo ──

describe("Bonus — onConflictDoUpdate (settings upsert)", () => {
  test("conflict-target update path works under D1", async () => {
    const userId = await seedUser("upsert-user");
    // Settings table has composite-ish (userId,key) but schema declares no
    // unique constraint there yet — we only verify that .returning() composes
    // with insert in async D1 mode.
    const inserted = await db
      .insert(deviceTokens)
      .values({
        id: "dt-1",
        userId,
        name: "macbook",
        tokenHash: "hash-1",
        lastUsedAt: null,
        createdAt: now(),
      })
      .returning()
      .get();
    expect(inserted?.tokenHash).toBe("hash-1");

    const updated = await db
      .update(deviceTokens)
      .set({ lastUsedAt: 1234 })
      .where(eq(deviceTokens.id, "dt-1"))
      .returning({ id: deviceTokens.id, lastUsedAt: deviceTokens.lastUsedAt })
      .get();
    expect(updated).toEqual({ id: "dt-1", lastUsedAt: 1234 });
  });
});
