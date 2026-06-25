/**
 * Phase 0B compatibility probe — does DashScope's qwen3-asr-flash-filetrans
 * model return one `transcripts` entry per audio track on a dual-track
 * `.m4a`? This is the gate the audio-pipeline rewrite in docs/06 rides on:
 * if DashScope cannot distinguish the two tracks the design must collapse
 * to a single-track downmix fallback (task #8).
 *
 * The test uploads `e2e/fixtures/dual-track-asr.m4a` (a 2-track AAC file
 * with two distinct Chinese TTS sentences — system track: 关键词 「云计算
 * 分布式存储 数据库索引」, microphone track: 关键词 「机器学习 神经网络
 * 深度学习」) and inspects what comes back.
 *
 * Live opt-in via `LYRE_RUN_LIVE_ASR=1`:
 *   - unset: skip with reason; normal `bun run test:e2e` stays green.
 *   - set:   no silent skip. Presign / transcribe / poll must succeed
 *            against a real Worker + DashScope env, or the test fails.
 *
 * The wrangler dev process holds the DashScope/OSS env (via .dev.vars
 * or wrangler --var), so checking `process.env.DASHSCOPE_API_KEY` here
 * would skip even when the Worker has the key. The opt-in flag makes
 * the contract explicit.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { post, get, json } from "./helpers";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "dual-track-asr.m4a",
);

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_MS = 240_000;

function liveModeEnabled(): boolean {
  return process.env.LYRE_RUN_LIVE_ASR === "1";
}

interface JobResource {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | string;
}

async function pollJobUntilTerminal(jobId: string): Promise<JobResource> {
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    const res = await get(`/api/jobs/${jobId}`);
    expect(res.status).toBe(200);
    const job = await json<JobResource>(res);
    if (job.status === "SUCCEEDED" || job.status === "FAILED") {
      return job;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Job ${jobId} did not reach terminal status in ${POLL_MAX_MS}ms`);
}

describe("DashScope multi-track ASR compatibility probe (Phase 0B)", () => {
  test("dual-track fixture surfaces both system and mic keywords", async () => {
    if (!liveModeEnabled()) {
      // Skip-with-reason. The Worker env (DashScope key + OSS creds) is
      // not visible to this process; only the explicit opt-in flag tells
      // us we are in a live-gate run.
      console.warn(
        "[asr-multitrack] LYRE_RUN_LIVE_ASR != 1 — skipping live ASR probe (see task #3 in #lyre-macos-rebuild)",
      );
      return;
    }

    // 1) Presign upload. In live mode any failure here is a hard fail —
    //    the Worker must have OSS creds.
    const presign = await post("/api/upload/presign", {
      fileName: "dual-track-asr.m4a",
      contentType: "audio/mp4",
    });
    expect(presign.status).toBe(200);
    const { uploadUrl, ossKey, recordingId } = await json<{
      uploadUrl: string;
      ossKey: string;
      recordingId: string;
    }>(presign);

    // 2) PUT the fixture to the presigned URL (real OSS endpoint).
    const fixtureBytes = await readFile(FIXTURE_PATH);
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "audio/mp4" },
      body: fixtureBytes,
    });
    expect(putRes.status).toBeGreaterThanOrEqual(200);
    expect(putRes.status).toBeLessThan(300);

    // 3) Create the recording row. POST /api/upload/presign only allocates
    //    a recordingId + presigned URL — it does not insert a row.
    //    The handler accepts an explicit `id` so we can reuse the one
    //    presign returned, which keeps any user-side bookkeeping aligned.
    const createRes = await post("/api/recordings", {
      id: recordingId,
      title: "asr-multitrack-fixture",
      fileName: "dual-track-asr.m4a",
      fileSize: fixtureBytes.byteLength,
      format: "m4a",
      ossKey,
    });
    expect(createRes.status).toBe(201);

    // 4) Trigger ASR. Handler returns 201 with the persisted job row;
    //    polling is driven by the Worker cron, we just poll /api/jobs/:id.
    const submitRes = await post(`/api/recordings/${recordingId}/transcribe`);
    expect(submitRes.status).toBe(201);
    const job = await json<JobResource>(submitRes);

    // 5) Poll the job. SUCCEEDED is the only happy path.
    const terminalJob = await pollJobUntilTerminal(job.id);
    expect(terminalJob.status).toBe("SUCCEEDED");

    // 6) Read recording detail — transcription.fullText is the only stable
    //    surface for keyword assertions. Raw transcripts JSON lives in
    //    the OSS result blob, not in this endpoint.
    const detailRes = await get(`/api/recordings/${recordingId}`);
    expect(detailRes.status).toBe(200);
    const detail = await json<{
      transcription: { fullText: string } | null;
    }>(detailRes);
    expect(detail.transcription).not.toBeNull();
    const fullText = detail.transcription?.fullText ?? "";

    // 7) THE PHASE 0B GATE: both tracks' keywords must appear. If only
    //    one track's keywords come through, DashScope collapsed the
    //    tracks and docs/06 Phase 3 (downmix fallback / task #8) becomes
    //    necessary.
    const systemKeywords = ["云计算", "分布式", "存储", "索引"];
    const micKeywords = ["机器学习", "神经网络", "深度学习"];
    const hits = (keywords: string[]) =>
      keywords.filter((k) => fullText.includes(k)).length;

    const sysHits = hits(systemKeywords);
    const micHits = hits(micKeywords);
    console.log(
      `[asr-multitrack] system keyword hits: ${sysHits}/${systemKeywords.length}; mic: ${micHits}/${micKeywords.length}`,
    );
    console.log(`[asr-multitrack] transcribed fullText: ${fullText}`);

    expect(sysHits).toBeGreaterThan(0);
    expect(micHits).toBeGreaterThan(0);
  });
});
