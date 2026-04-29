import { describe, expect, test } from "bun:test";
import { get, post, del, json } from "./helpers";

describe("recordings endpoints", () => {
  test("GET /api/recordings returns 200 with paginated structure", async () => {
    const res = await get("/api/recordings");
    expect(res.status).toBe(200);
    const body = await json<{ items: unknown[]; total: number }>(res);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("POST /api/recordings creates a recording (201)", async () => {
    const res = await post("/api/recordings", {
      title: "e2e-test-recording",
      fileName: "test.m4a",
      ossKey: "uploads/e2e/test.m4a",
    });
    expect(res.status).toBe(201);
    const body = await json<{ id: string }>(res);
    expect(typeof body.id).toBe("string");

    // GET /api/recordings/:id
    const getRes = await get(`/api/recordings/${body.id}`);
    expect(getRes.status).toBe(200);

    // PUT /api/recordings/:id
    const putRes = await fetch(
      `http://localhost:7017/api/recordings/${body.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "e2e-test-recording-updated" }),
      },
    );
    expect(putRes.status).toBe(200);

    // GET /api/recordings/:id/play-url (500 when OSS not configured)
    const playRes = await get(`/api/recordings/${body.id}/play-url`);
    expect([200, 500]).toContain(playRes.status);

    // GET /api/recordings/:id/download-url (500 when OSS not configured)
    const dlRes = await get(`/api/recordings/${body.id}/download-url`);
    expect([200, 500]).toContain(dlRes.status);

    // GET /api/recordings/:id/words (404 if no transcription yet)
    const wordsRes = await get(`/api/recordings/${body.id}/words`);
    expect([200, 404]).toContain(wordsRes.status);

    // POST /api/recordings/:id/transcribe (mock ASR, no DASHSCOPE_API_KEY)
    const transcribeRes = await post(`/api/recordings/${body.id}/transcribe`);
    // 200 (mock) or 500 (real ASR missing key) — both acceptable
    expect([200, 500]).toContain(transcribeRes.status);

    // POST /api/recordings/:id/summarize (needs AI key, may fail)
    const summarizeRes = await post(`/api/recordings/${body.id}/summarize`);
    expect([200, 400, 500]).toContain(summarizeRes.status);

    // DELETE /api/recordings/:id
    const deleteRes = await del(`/api/recordings/${body.id}`);
    expect(deleteRes.status).toBe(200);
  });

  test("DELETE /api/recordings/batch returns 200", async () => {
    const res = await del("/api/recordings/batch", { ids: ["nonexistent"] });
    expect(res.status).toBe(200);
  });

  test("POST /api/recordings/batch-delete returns 200", async () => {
    const res = await post("/api/recordings/batch-delete", {
      ids: ["nonexistent"],
    });
    expect(res.status).toBe(200);
  });
});
