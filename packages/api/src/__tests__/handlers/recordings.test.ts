/**
 * Tests for `handlers/recordings.ts` (sync handlers; async ones tested in
 * separate file per legacy testing convention).
 */

import { describe, expect, it } from "bun:test";
import {
  listRecordingsHandler,
  createRecordingHandler,
  getRecordingHandler,
  updateRecordingHandler,
  deleteRecordingHandler,
  batchDeleteRecordingsHandler,
  playUrlHandler,
  downloadUrlHandler,
  wordsHandler,
} from "../../handlers/recordings";
import {
  makeCtx,
  setupAnonCtx,
  setupAuthedCtx,
} from "../_fixtures/runtime-context";
import { jobsRepo } from "../../db/repositories";

function withMockedFetch<T>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    impl(typeof url === "string" ? url : url.toString(), init)) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

const ossEnv = {
  OSS_ACCESS_KEY_ID: "ak",
  OSS_ACCESS_KEY_SECRET: "sk",
  OSS_BUCKET: "bucket",
  OSS_REGION: "oss-cn",
  OSS_ENDPOINT: "https://oss.example.com",
  SKIP_OSS_ARCHIVE: "1",
};

describe("listRecordingsHandler", () => {
  it("401 anon", () => {
    expect(
      listRecordingsHandler(setupAnonCtx(), {}).status,
    ).toBe(401);
  });
  it("empty list authed", () => {
    const { ctx } = setupAuthedCtx();
    const res = listRecordingsHandler(ctx, {});
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
  });
  it("filters by folderId=unfiled", () => {
    const { ctx } = setupAuthedCtx();
    expect(
      listRecordingsHandler(ctx, { folderId: "unfiled" }).status,
    ).toBe(200);
  });
});

describe("createRecordingHandler", () => {
  it("401 anon", () => {
    expect(
      createRecordingHandler(setupAnonCtx(), {
        title: "t",
        fileName: "f",
        ossKey: "o",
      }).status,
    ).toBe(401);
  });
  it("400 missing fields", () => {
    const { ctx } = setupAuthedCtx();
    expect(createRecordingHandler(ctx, {}).status).toBe(400);
  });
  it("creates recording", () => {
    const { ctx } = setupAuthedCtx();
    const res = createRecordingHandler(ctx, {
      title: "Hello",
      fileName: "h.m4a",
      ossKey: "uploads/x/y/h.m4a",
    });
    expect(res.status).toBe(201);
  });
});

describe("get/update/recording", () => {
  it("404 unknown id", () => {
    const { ctx } = setupAuthedCtx();
    expect(getRecordingHandler(ctx, "no").status).toBe(404);
    expect(updateRecordingHandler(ctx, "no", { title: "x" }).status).toBe(404);
  });
  it("authed get/update round-trip", () => {
    const { ctx } = setupAuthedCtx();
    const created = createRecordingHandler(ctx, {
      title: "A",
      fileName: "a.m4a",
      ossKey: "uploads/x/y/a.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect(getRecordingHandler(ctx, id).status).toBe(200);
    expect(updateRecordingHandler(ctx, id, { title: "B" }).status).toBe(200);
  });
  it("401 anon", () => {
    expect(getRecordingHandler(setupAnonCtx(), "x").status).toBe(401);
    expect(updateRecordingHandler(setupAnonCtx(), "x", {}).status).toBe(401);
  });
});

describe("delete + batch", () => {
  it("401 anon", async () => {
    expect((await deleteRecordingHandler(setupAnonCtx(), "x")).status).toBe(
      401,
    );
    expect(
      (await batchDeleteRecordingsHandler(setupAnonCtx(), {})).status,
    ).toBe(401);
  });
  it("404 unknown", async () => {
    const { ctx } = setupAuthedCtx();
    expect((await deleteRecordingHandler(ctx, "no")).status).toBe(404);
  });
  it("400 batch invalid", async () => {
    const { ctx } = setupAuthedCtx();
    expect(
      (await batchDeleteRecordingsHandler(ctx, { ids: [] })).status,
    ).toBe(400);
    expect(
      (await batchDeleteRecordingsHandler(ctx, { ids: "no" })).status,
    ).toBe(400);
  });
  it("batch with no owned ids returns 0", async () => {
    const { ctx } = setupAuthedCtx();
    const res = await batchDeleteRecordingsHandler(ctx, {
      ids: ["nope-1", "nope-2"],
    });
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { deleted: number }).deleted).toBe(0);
  });
  it("batch over max", async () => {
    const { ctx } = setupAuthedCtx();
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(
      (await batchDeleteRecordingsHandler(ctx, { ids })).status,
    ).toBe(400);
  });
  it("delete owned recording (no oss key path)", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    const res = await deleteRecordingHandler(ctx, id);
    expect(res.status).toBe(200);
  });
});

describe("playUrl/downloadUrl handlers", () => {
  it("401 anon", () => {
    expect(playUrlHandler(setupAnonCtx(), "x").status).toBe(401);
    expect(downloadUrlHandler(setupAnonCtx(), "x").status).toBe(401);
  });
  it("404 unknown", () => {
    const { ctx } = setupAuthedCtx();
    expect(playUrlHandler(ctx, "no").status).toBe(404);
    expect(downloadUrlHandler(ctx, "no").status).toBe(404);
  });
  it("returns presigned URLs for owned recording", () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    expect(playUrlHandler(ctx, id).status).toBe(200);
    expect(downloadUrlHandler(ctx, id).status).toBe(200);
  });
});

describe("wordsHandler", () => {
  it("401 anon", async () => {
    expect((await wordsHandler(setupAnonCtx(), "x")).status).toBe(401);
  });
  it("404 unknown", async () => {
    const { ctx } = setupAuthedCtx();
    expect((await wordsHandler(ctx, "no")).status).toBe(404);
  });
  it("404 when no completed transcription", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const id = (created.body as { id: string }).id;
    const res = await wordsHandler(ctx, id);
    expect(res.status).toBe(404);
  });
  it("returns sentences for SUCCEEDED job (mocked OSS fetch)", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const recId = (created.body as { id: string }).id;
    const job = jobsRepo.create({
      id: "job-w-1",
      recordingId: recId,
      taskId: "task-1",
      requestId: null,
      status: "SUCCEEDED",
    });
    void job;
    const fakeAsr = {
      transcripts: [
        {
          sentences: [
            {
              sentence_id: 1,
              words: [
                { begin_time: 0, end_time: 100, text: "hi", punctuation: "" },
              ],
            },
          ],
        },
      ],
    };
    const res = await withMockedFetch(
      async () =>
        new Response(JSON.stringify(fakeAsr), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      () => wordsHandler(ctx, recId),
    );
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { sentences: Array<{ sentenceId: number }> };
    expect(body.sentences[0]?.sentenceId).toBe(1);
  });
  it("502 when OSS fetch returns non-ok", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const recId = (created.body as { id: string }).id;
    jobsRepo.create({
      id: "job-w-2",
      recordingId: recId,
      taskId: "task-2",
      requestId: null,
      status: "SUCCEEDED",
    });
    const res = await withMockedFetch(
      async () => new Response("nope", { status: 500 }),
      () => wordsHandler(ctx, recId),
    );
    expect(res.status).toBe(502);
  });
  it("500 when fetch throws", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const recId = (created.body as { id: string }).id;
    jobsRepo.create({
      id: "job-w-3",
      recordingId: recId,
      taskId: "task-3",
      requestId: null,
      status: "SUCCEEDED",
    });
    const res = await withMockedFetch(
      async () => {
        throw new Error("boom");
      },
      () => wordsHandler(ctx, recId),
    );
    expect(res.status).toBe(500);
  });
  it("returns empty sentences when transcripts is empty", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const recId = (created.body as { id: string }).id;
    jobsRepo.create({
      id: "job-w-4",
      recordingId: recId,
      taskId: "task-4",
      requestId: null,
      status: "SUCCEEDED",
    });
    const res = await withMockedFetch(
      async () =>
        new Response(JSON.stringify({ transcripts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      () => wordsHandler(ctx, recId),
    );
    expect(res.status).toBe(200);
  });
});

describe("batch delete with owned recording", () => {
  it("batch delete owned recording with associated job", async () => {
    const { user } = setupAuthedCtx();
    const ctx = makeCtx(user, { env: ossEnv });
    const created = createRecordingHandler(ctx, {
      title: "X",
      fileName: "x.m4a",
      ossKey: "uploads/u/r/x.m4a",
    });
    if (created.kind !== "json") throw new Error();
    const recId = (created.body as { id: string }).id;
    jobsRepo.create({
      id: "job-bd-1",
      recordingId: recId,
      taskId: "task-bd-1",
      requestId: null,
      status: "SUCCEEDED",
    });
    const res = await batchDeleteRecordingsHandler(ctx, { ids: [recId] });
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    expect((res.body as { deleted: number }).deleted).toBe(1);
  });
});
