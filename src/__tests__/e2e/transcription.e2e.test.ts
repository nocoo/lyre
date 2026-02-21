import { describe, expect, test, beforeAll, afterAll } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17025"}`;

// ── Types ──

interface Recording {
  id: string;
  title: string;
  status: string;
  ossKey: string;
}

interface TranscriptionJob {
  id: string;
  recordingId: string;
  taskId: string;
  requestId: string | null;
  status: string;
  submitTime: string | null;
  endTime: string | null;
  usageSeconds: number | null;
  errorMessage: string | null;
  resultUrl: string | null;
}

interface TranscriptionSentence {
  sentenceId: number;
  beginTime: number;
  endTime: number;
  text: string;
  language: string;
  emotion: string;
}

interface Transcription {
  id: string;
  recordingId: string;
  jobId: string;
  fullText: string;
  sentences: TranscriptionSentence[] | string;
  language: string | null;
}

interface RecordingDetail extends Recording {
  transcription: Transcription | null;
  latestJob: TranscriptionJob | null;
}

// ── Helpers ──

async function createRecording(
  title: string,
  ossKey: string,
): Promise<Recording> {
  const res = await fetch(`${BASE_URL}/api/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.mp3`,
      fileSize: 5_000_000,
      format: "mp3",
      ossKey,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Recording;
}

async function getDetail(id: string): Promise<RecordingDetail> {
  const res = await fetch(`${BASE_URL}/api/recordings/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as RecordingDetail;
}

async function deleteRecording(id: string): Promise<void> {
  await fetch(`${BASE_URL}/api/recordings/${id}`, { method: "DELETE" });
}

/**
 * Poll a job until it reaches a terminal state (SUCCEEDED or FAILED).
 * Returns the final job state. Max 20 polls (mock provider needs ~3).
 */
async function pollUntilDone(
  jobId: string,
  maxPolls = 20,
): Promise<TranscriptionJob> {
  let job: TranscriptionJob | null = null;
  for (let i = 0; i < maxPolls; i++) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
    expect(res.status).toBe(200);
    job = (await res.json()) as TranscriptionJob;
    if (job.status === "SUCCEEDED" || job.status === "FAILED") {
      return job;
    }
    // Small delay between polls to avoid hammering
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${jobId} did not reach terminal state after ${maxPolls} polls`);
}

// ── Setup / Teardown ──

const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds) {
    await deleteRecording(id);
  }
});

// ── Tests ──

describe("POST /api/recordings/[id]/transcribe", () => {
  test("triggers transcription and returns a job", async () => {
    const rec = await createRecording(
      "ASR Test Recording",
      "uploads/e2e/asr-test.mp3",
    );
    createdIds.push(rec.id);

    const res = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/transcribe`,
      { method: "POST" },
    );
    expect(res.status).toBe(201);

    const job = (await res.json()) as TranscriptionJob;
    expect(job.id).toBeTruthy();
    expect(job.recordingId).toBe(rec.id);
    expect(job.taskId).toContain("mock-task-");
    expect(job.status).toBe("PENDING");

    // Recording status should be updated to "transcribing"
    const detail = await getDetail(rec.id);
    expect(detail.status).toBe("transcribing");
    expect(detail.latestJob).not.toBeNull();
    expect(detail.latestJob!.id).toBe(job.id);
  });

  test("returns 409 when recording is already transcribing", async () => {
    // Use the recording from previous test (still transcribing)
    const id = createdIds[0]!;

    const res = await fetch(`${BASE_URL}/api/recordings/${id}/transcribe`, {
      method: "POST",
    });
    expect(res.status).toBe(409);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("already being transcribed");
  });

  test("returns 404 for unknown recording", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings/nonexistent-id-999/transcribe`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/jobs/[id] (polling)", () => {
  let testRecordingId: string;
  let testJobId: string;

  beforeAll(async () => {
    // Create a fresh recording and trigger transcription
    const rec = await createRecording(
      "Poll Test Recording",
      "uploads/e2e/poll-test.mp3",
    );
    createdIds.push(rec.id);
    testRecordingId = rec.id;

    const res = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/transcribe`,
      { method: "POST" },
    );
    expect(res.status).toBe(201);
    const job = (await res.json()) as TranscriptionJob;
    testJobId = job.id;
  });

  test("returns current job status on poll", async () => {
    const res = await fetch(`${BASE_URL}/api/jobs/${testJobId}`);
    expect(res.status).toBe(200);

    const job = (await res.json()) as TranscriptionJob;
    expect(job.id).toBe(testJobId);
    // After first poll, mock provider transitions from PENDING to RUNNING
    expect(["PENDING", "RUNNING"]).toContain(job.status);
  });

  test("returns 404 for unknown job id", async () => {
    const res = await fetch(`${BASE_URL}/api/jobs/nonexistent-job-999`);
    expect(res.status).toBe(404);
  });

  test("polls until SUCCEEDED and saves transcription", async () => {
    // Poll until done (mock provider: PENDING→RUNNING→SUCCEEDED in ~3 polls)
    const finalJob = await pollUntilDone(testJobId);

    expect(finalJob.status).toBe("SUCCEEDED");
    expect(finalJob.resultUrl).toBeTruthy();
    expect(finalJob.usageSeconds).toBe(42); // mock provider returns 42
    expect(finalJob.submitTime).toBeTruthy();
    expect(finalJob.endTime).toBeTruthy();

    // Verify recording status updated to "completed"
    const detail = await getDetail(testRecordingId);
    expect(detail.status).toBe("completed");

    // Verify transcription was saved
    expect(detail.transcription).not.toBeNull();
    expect(detail.transcription!.fullText).toContain("Hello world");
    expect(detail.transcription!.jobId).toBe(testJobId);
    expect(detail.transcription!.language).toBe("en");

    // Parse sentences — may be string (from DB JSON) or array
    const sentences =
      typeof detail.transcription!.sentences === "string"
        ? (JSON.parse(detail.transcription!.sentences) as TranscriptionSentence[])
        : detail.transcription!.sentences;
    expect(sentences.length).toBe(2);
    expect(sentences[0]!.text).toBe("Hello world.");
    expect(sentences[1]!.text).toBe("This is a test transcription.");
  });

  test("returns terminal state directly without re-polling", async () => {
    // Job is already SUCCEEDED — should return immediately without polling ASR
    const res = await fetch(`${BASE_URL}/api/jobs/${testJobId}`);
    expect(res.status).toBe(200);

    const job = (await res.json()) as TranscriptionJob;
    expect(job.status).toBe("SUCCEEDED");
  });
});

describe("re-transcription flow", () => {
  test("allows re-transcription of completed recording", async () => {
    // Create and complete a recording first
    const rec = await createRecording(
      "Retranscribe Test",
      "uploads/e2e/retranscribe-test.mp3",
    );
    createdIds.push(rec.id);

    // First transcription
    const res1 = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/transcribe`,
      { method: "POST" },
    );
    expect(res1.status).toBe(201);
    const job1 = (await res1.json()) as TranscriptionJob;

    // Poll until done
    const finalJob1 = await pollUntilDone(job1.id);
    expect(finalJob1.status).toBe("SUCCEEDED");

    // Verify recording is completed
    const detail1 = await getDetail(rec.id);
    expect(detail1.status).toBe("completed");

    // Trigger re-transcription — should succeed since status is "completed"
    const res2 = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/transcribe`,
      { method: "POST" },
    );
    expect(res2.status).toBe(201);
    const job2 = (await res2.json()) as TranscriptionJob;
    expect(job2.id).not.toBe(job1.id); // New job

    // Recording should be back to "transcribing"
    const detail2 = await getDetail(rec.id);
    expect(detail2.status).toBe("transcribing");

    // Poll second job until done
    const finalJob2 = await pollUntilDone(job2.id);
    expect(finalJob2.status).toBe("SUCCEEDED");

    // Verify recording is completed again
    const detail3 = await getDetail(rec.id);
    expect(detail3.status).toBe("completed");
    expect(detail3.transcription).not.toBeNull();
  });
});
