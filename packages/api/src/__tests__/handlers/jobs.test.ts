/**
 * Tests for `handlers/jobs.ts`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  cronTickHandler,
  getJobHandler,
  listJobsHandler,
} from "../../handlers/jobs";
import { jobsRepo, recordingsRepo } from "../../db/repositories";
import {
  resetAsrProvider,
  setAsrProvider,
} from "../../services/asr-provider";
import type { AsrProvider } from "../../services/asr";
import { setupAnonCtx, setupAuthedCtx } from "../_fixtures/runtime-context";

describe("getJobHandler", () => {
  it("401 anon", async () => {
    const res = await getJobHandler(setupAnonCtx(), "x");
    expect(res.status).toBe(401);
  });
  it("404 unknown job", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await getJobHandler(ctx, "no-such-job");
    expect(res.status).toBe(404);
  });
});

describe("listJobsHandler", () => {
  it("401 anon", async () => {
    const res = await listJobsHandler(setupAnonCtx());
    expect(res.status).toBe(401);
  });
  it("returns empty list when user has no recordings", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await listJobsHandler(ctx);
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect(res.body).toEqual({ items: [] });
  });
  it("returns empty list when filtering by recording owned by another user", async () => {
    const { ctx } = await setupAuthedCtx();
    const res = await listJobsHandler(ctx, "no-such-recording");
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect(res.body).toEqual({ items: [] });
  });
  it("filters by recordingId for the owning user", async () => {
    const { ctx, user } = await setupAuthedCtx();
    const rec = await recordingsRepo.create({
      id: "r1",
      userId: user.id,
      title: "t",
      description: null,
      fileName: "f.m4a",
      fileSize: null,
      duration: null,
      format: null,
      sampleRate: null,
      ossKey: "k",
      status: "transcribing",
    });
    await jobsRepo.create({
      id: "j1",
      recordingId: rec.id,
      taskId: "tk1",
      requestId: null,
      status: "PENDING",
    });
    const res = await listJobsHandler(ctx, rec.id);
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe("j1");
  });
  it("returns active jobs across user's recordings when no filter", async () => {
    const { ctx, user } = await setupAuthedCtx();
    const rec = await recordingsRepo.create({
      id: "r2",
      userId: user.id,
      title: "t",
      description: null,
      fileName: "f.m4a",
      fileSize: null,
      duration: null,
      format: null,
      sampleRate: null,
      ossKey: "k",
      status: "transcribing",
    });
    await jobsRepo.create({
      id: "ja",
      recordingId: rec.id,
      taskId: "tka",
      requestId: null,
      status: "RUNNING",
    });
    const res = await listJobsHandler(ctx);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).toContain("ja");
  });
});

describe("cronTickHandler", () => {
  afterEach(() => resetAsrProvider());

  function makeMockProvider(overrides: Partial<AsrProvider> = {}): AsrProvider {
    return {
      submit: async () => ({
        request_id: "rq",
        output: { task_id: "t", task_status: "PENDING" },
      }),
      poll: async () => ({
        request_id: "rq",
        output: { task_id: "t", task_status: "RUNNING" },
      }),
      fetchResult: async () => ({
        file_url: "u",
        audio_info: { format: "m4a", sample_rate: 16000 },
        transcripts: [],
      }),
      ...overrides,
    };
  }

  it("scans 0 active jobs cleanly", async () => {
    const { ctx } = await setupAuthedCtx();
    setAsrProvider(makeMockProvider());
    const r = await cronTickHandler(ctx);
    expect(r).toEqual({ scanned: 0, changed: 0, failed: 0, errors: [] });
  });

  it("polls active jobs and reports changes", async () => {
    const { ctx, user } = await setupAuthedCtx();
    const rec = await recordingsRepo.create({
      id: "r-cron-1",
      userId: user.id,
      title: "t",
      description: null,
      fileName: "a.m4a",
      fileSize: null,
      duration: null,
      format: null,
      sampleRate: null,
      ossKey: "k",
      status: "transcribing",
    });
    await jobsRepo.create({
      id: "job-cron-1",
      recordingId: rec.id,
      taskId: "task-1",
      requestId: null,
      status: "PENDING",
    });

    setAsrProvider(
      makeMockProvider({
        poll: async () => ({
          request_id: "rq",
          output: { task_id: "task-1", task_status: "RUNNING" },
        }),
      }),
    );

    const r = await cronTickHandler(ctx);
    expect(r.scanned).toBe(1);
    expect(r.changed).toBe(1);
    expect(r.failed).toBe(0);
  });

  it("captures provider errors per job without aborting the tick", async () => {
    const { ctx, user } = await setupAuthedCtx();
    const rec = await recordingsRepo.create({
      id: "r-cron-2",
      userId: user.id,
      title: "t",
      description: null,
      fileName: "a.m4a",
      fileSize: null,
      duration: null,
      format: null,
      sampleRate: null,
      ossKey: "k",
      status: "transcribing",
    });
    await jobsRepo.create({
      id: "job-cron-2",
      recordingId: rec.id,
      taskId: "task-2",
      requestId: null,
      status: "RUNNING",
    });

    setAsrProvider(
      makeMockProvider({
        poll: async () => {
          throw new Error("boom");
        },
      }),
    );

    const r = await cronTickHandler(ctx);
    expect(r.scanned).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.errors[0]?.jobId).toBe("job-cron-2");
    expect(r.errors[0]?.message).toContain("boom");
  });
});
