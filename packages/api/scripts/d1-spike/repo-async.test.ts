/**
 * D1 Repo async-mismatch probe — Wave B.6.b.4.
 *
 * The existing spike.test.ts proves drizzle-orm/d1 itself works on Lyre's
 * schema using `await`. This probe goes one layer up: it instantiates each
 * `make<Name>Repo(db)` factory from packages/api against a D1 binding and
 * exercises every method, capturing the *behavior class* of each call site
 * under D1 (where every terminal op `.get()/.run()/.all()` returns a Promise
 * but the repo code treats the value as sync).
 *
 * Behavior classes (per method):
 *   - `promise`        — call returned a Promise (Wave C must `await` it
 *                         or rewrite the repo method as async)
 *   - `silent-wrong`   — call returned a non-Promise non-throwing value
 *                         that is wrong because intermediate ops are async
 *                         (e.g. `(promise).changes > 0` evaluates to false
 *                         without ever waiting). Must rewrite as async.
 *   - `throw:<msg>`    — call threw synchronously. Rewrite as async.
 *
 * The output is a precise punch list that Wave C async-rewrite uses.
 *
 * Run:
 *   cd packages/api/scripts/d1-spike
 *   bun test repo-async.test.ts
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";

import { makeUsersRepo } from "../../src/db/repositories/users";
import { makeFoldersRepo } from "../../src/db/repositories/folders";
import { makeTagsRepo } from "../../src/db/repositories/tags";
import { makeRecordingsRepo } from "../../src/db/repositories/recordings";
import { makeJobsRepo } from "../../src/db/repositories/jobs";
import { makeTranscriptionsRepo } from "../../src/db/repositories/transcriptions";
import { makeSettingsRepo } from "../../src/db/repositories/settings";
import { makeDeviceTokensRepo } from "../../src/db/repositories/device-tokens";

let mf: Miniflare;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  const d1 = await mf.getD1Database("DB");
  db = drizzle(d1);

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

type Verdict = "promise" | "silent-wrong" | `throw:${string}`;

function probe(fn: () => unknown): Verdict {
  try {
    const r = fn();
    if (r && typeof (r as { then?: unknown }).then === "function") {
      // Suppress unhandled rejection — D1 may complain about FK on test data.
      (r as Promise<unknown>).catch(() => {});
      return "promise";
    }
    // Sync returned a non-Promise. For repos, every method is supposed to
    // return a real value derived from a DB hit — under D1 that's impossible
    // synchronously, so any non-Promise return is a silent-wrong answer.
    return "silent-wrong";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `throw:${msg.slice(0, 80)}`;
  }
}

const findings: Record<string, Record<string, Verdict>> = {};

function record(repoName: string, results: Record<string, Verdict>): void {
  findings[repoName] = results;
  console.log(`\n[D1 probe] ${repoName}:`);
  for (const [method, verdict] of Object.entries(results)) {
    console.log(`  ${method.padEnd(28)} → ${verdict}`);
  }
}

describe("D1 repo async probe — every read/write method", () => {
  test("users repo", () => {
    const r = makeUsersRepo(db);
    record("users", {
      findAll: probe(() => r.findAll()),
      findById: probe(() => r.findById("x")),
      findByEmail: probe(() => r.findByEmail("x@y")),
      create: probe(() =>
        r.create({ id: "u1", email: "u1@x", name: null, avatarUrl: null }),
      ),
      delete: probe(() => r.delete("x")),
    });
  });

  test("folders repo", () => {
    const r = makeFoldersRepo(db);
    record("folders", {
      findByUserId: probe(() => r.findByUserId("u")),
      findById: probe(() => r.findById("f")),
      findByIdAndUser: probe(() => r.findByIdAndUser("f", "u")),
      create: probe(() => r.create({ id: "f1", userId: "u", name: "n", icon: "i" })),
      update: probe(() => r.update("f", { name: "n2" })),
      delete: probe(() => r.delete("f")),
    });
  });

  test("tags repo", () => {
    const r = makeTagsRepo(db);
    record("tags", {
      findByUserId: probe(() => r.findByUserId("u")),
      findById: probe(() => r.findById("t")),
      findByIdAndUser: probe(() => r.findByIdAndUser("t", "u")),
      findByNameAndUser: probe(() => r.findByNameAndUser("n", "u")),
      create: probe(() => r.create({ id: "t1", userId: "u", name: "n" })),
      findTagIdsForRecording: probe(() => r.findTagIdsForRecording("r")),
      findTagsForRecording: probe(() => r.findTagsForRecording("r")),
    });
  });

  test("recordings repo", () => {
    const r = makeRecordingsRepo(db);
    record("recordings", {
      findAll: probe(() => r.findAll("u")),
      findById: probe(() => r.findById("r")),
      create: probe(() =>
        r.create({
          id: "r1",
          userId: "u",
          title: "t",
          description: null,
          fileName: "f",
          fileSize: null,
          duration: null,
          format: null,
          sampleRate: null,
          ossKey: "k",
          status: "uploaded",
        }),
      ),
      update: probe(() => r.update("r", { title: "t2" })),
      delete: probe(() => r.delete("r")),
    });
  });

  test("jobs repo", () => {
    const r = makeJobsRepo(db);
    record("jobs", {
      findById: probe(() => r.findById("j")),
      findByTaskId: probe(() => r.findByTaskId("t")),
      findByRecordingId: probe(() => r.findByRecordingId("r")),
      findActive: probe(() => r.findActive()),
      create: probe(() =>
        r.create({
          id: "j1",
          recordingId: "r1",
          taskId: "tk",
          requestId: null,
          status: "PENDING",
        }),
      ),
    });
  });

  test("transcriptions repo", () => {
    const r = makeTranscriptionsRepo(db);
    record("transcriptions", {
      findById: probe(() => r.findById("t")),
      findByRecordingId: probe(() => r.findByRecordingId("r")),
      deleteByRecordingId: probe(() => r.deleteByRecordingId("r")),
    });
  });

  test("settings repo", () => {
    const r = makeSettingsRepo(db);
    record("settings", {
      findByUserId: probe(() => r.findByUserId("u")),
      findByKey: probe(() => r.findByKey("u", "k")),
      upsert: probe(() => r.upsert("u", "k", "v")),
      delete: probe(() => r.delete("u", "k")),
    });
  });

  test("device-tokens repo", () => {
    const r = makeDeviceTokensRepo(db);
    record("deviceTokens", {
      findById: probe(() => r.findById("dt")),
      findByUserId: probe(() => r.findByUserId("u")),
      findByHash: probe(() => r.findByHash("h")),
      create: probe(() =>
        r.create({ id: "dt1", userId: "u", name: "n", tokenHash: "h" }),
      ),
      deleteByIdAndUser: probe(() => r.deleteByIdAndUser("dt", "u")),
    });
  });

  test("FINDING: every repo method is async-correct under D1 dialect", () => {
    // Post Wave C.0: every repo method must return a Promise under D1.
    // `silent-wrong` or `throw:*` verdicts mean the rewrite missed a call site.
    let totalMethods = 0;
    let asyncMethods = 0;
    const broken: string[] = [];
    for (const [repoName, results] of Object.entries(findings)) {
      for (const [method, verdict] of Object.entries(results)) {
        totalMethods++;
        if (verdict === "promise") {
          asyncMethods++;
        } else {
          broken.push(`${repoName}.${method}=${verdict}`);
        }
      }
    }
    console.log(
      `\n[D1 probe] ${asyncMethods}/${totalMethods} repo methods are async (promise-returning)`,
    );
    if (broken.length > 0) {
      console.log(`[D1 probe] still-broken: ${broken.join(", ")}`);
    }
    expect(broken).toEqual([]);
    expect(asyncMethods).toBe(totalMethods);
    expect(totalMethods).toBeGreaterThanOrEqual(40);
  });
});

describe("Confirmation: drizzle d1 chain works when awaited", () => {
  test("awaiting the leaked Promise returns real data", async () => {
    const r = makeUsersRepo(db);
    const sync = r.findAll() as unknown;
    expect(typeof (sync as { then?: unknown }).then).toBe("function");
    const rows = await (sync as Promise<unknown[]>);
    expect(Array.isArray(rows)).toBe(true);
  });
});
