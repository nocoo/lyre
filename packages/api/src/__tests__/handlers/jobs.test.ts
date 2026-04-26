/**
 * Tests for `handlers/jobs.ts`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { cronTickHandler, getJobHandler } from "../../handlers/jobs";
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
    const { ctx } = setupAuthedCtx();
    const res = await getJobHandler(ctx, "no-such-job");
    expect(res.status).toBe(404);
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
    const { ctx } = setupAuthedCtx();
    setAsrProvider(makeMockProvider());
    const r = await cronTickHandler(ctx);
    expect(r).toEqual({ scanned: 0, changed: 0, failed: 0, errors: [] });
  });

  it("polls active jobs and reports changes", async () => {
    const { ctx, user } = setupAuthedCtx();
    const rec = recordingsRepo.create({
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
    jobsRepo.create({
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
    const { ctx, user } = setupAuthedCtx();
    const rec = recordingsRepo.create({
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
    jobsRepo.create({
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
