import { describe, expect, test, afterAll } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17025"}`;

// ── Types ──

interface AiSettings {
  provider: string;
  apiKey: string;
  hasApiKey: boolean;
  model: string;
  autoSummarize: boolean;
  baseURL: string;
  sdkType: string;
}

interface Recording {
  id: string;
  title: string;
  status: string;
}

interface TranscriptionJob {
  id: string;
  status: string;
}

// ── Helpers ──

async function createRecording(title: string): Promise<Recording> {
  const res = await fetch(`${BASE_URL}/api/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.mp3`,
      fileSize: 1_000_000,
      format: "mp3",
      ossKey: `uploads/e2e/${crypto.randomUUID()}.mp3`,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Recording;
}

async function deleteRecording(id: string): Promise<void> {
  await fetch(`${BASE_URL}/api/recordings/${id}`, { method: "DELETE" });
}

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${jobId} did not reach terminal state`);
}

// ── Cleanup ──

const createdIds: string[] = [];

afterAll(async () => {
  // Reset AI settings to empty after tests
  await fetch(`${BASE_URL}/api/settings/ai`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "",
      apiKey: "",
      model: "",
      autoSummarize: false,
      baseURL: "",
      sdkType: "",
    }),
  });
  for (const id of createdIds) {
    await deleteRecording(id);
  }
});

// ── AI Settings API ──

describe("AI settings API", () => {
  test("GET /api/settings/ai returns defaults when unconfigured", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    expect(body.provider).toBe("");
    expect(body.apiKey).toBe("");
    expect(body.hasApiKey).toBe(false);
    expect(body.model).toBe("");
    expect(body.autoSummarize).toBe(false);
  });

  test("PUT /api/settings/ai saves configuration", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "anthropic",
        apiKey: "sk-test-1234567890",
        model: "claude-sonnet-4-20250514",
        autoSummarize: true,
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    expect(body.provider).toBe("anthropic");
    expect(body.hasApiKey).toBe(true);
    // API key should be masked
    expect(body.apiKey).toContain("****");
    expect(body.apiKey).toEndWith("7890");
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.autoSummarize).toBe(true);
  });

  test("GET /api/settings/ai returns saved config", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    expect(body.provider).toBe("anthropic");
    expect(body.hasApiKey).toBe(true);
    expect(body.autoSummarize).toBe(true);
  });

  test("PUT /api/settings/ai rejects invalid provider", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "invalid-provider" }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid provider");
  });

  test("PUT /api/settings/ai allows partial update", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoSummarize: false }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    // Provider should still be anthropic (not cleared)
    expect(body.provider).toBe("anthropic");
    expect(body.autoSummarize).toBe(false);
  });

  test("PUT /api/settings/ai can clear config", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "",
        apiKey: "",
        model: "",
        autoSummarize: false,
        baseURL: "",
        sdkType: "",
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    expect(body.provider).toBe("");
    expect(body.hasApiKey).toBe(false);
    expect(body.autoSummarize).toBe(false);
  });

  test("PUT /api/settings/ai accepts custom provider with baseURL and sdkType", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "custom",
        apiKey: "sk-custom-1234567890",
        model: "my-model-v1",
        baseURL: "https://my-api.example.com/v1",
        sdkType: "openai",
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    expect(body.provider).toBe("custom");
    expect(body.hasApiKey).toBe(true);
    expect(body.model).toBe("my-model-v1");
    expect(body.baseURL).toBe("https://my-api.example.com/v1");
    expect(body.sdkType).toBe("openai");
  });

  test("GET /api/settings/ai returns custom provider fields", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AiSettings;
    expect(body.provider).toBe("custom");
    expect(body.baseURL).toBe("https://my-api.example.com/v1");
    expect(body.sdkType).toBe("openai");
  });

  test("PUT /api/settings/ai rejects invalid sdkType", async () => {
    const res = await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdkType: "invalid-sdk" }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid SDK type");
  });
});

// ── Summarize API error paths ──

describe("POST /api/recordings/[id]/summarize", () => {
  test("returns 404 for unknown recording", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings/nonexistent-id/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  test("returns 400 when AI is not configured", async () => {
    // Ensure AI config is cleared (previous tests may have set custom provider)
    await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "",
        apiKey: "",
        model: "",
        autoSummarize: false,
        baseURL: "",
        sdkType: "",
      }),
    });

    // Create a recording and transcribe it so it has a transcription
    const rec = await createRecording("Summarize Unconfigured Test");
    createdIds.push(rec.id);

    // Transcribe first
    const transcribeRes = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/transcribe`,
      { method: "POST" },
    );
    expect(transcribeRes.status).toBe(201);
    const job = (await transcribeRes.json()) as TranscriptionJob;
    await pollUntilDone(job.id);

    // Try to summarize without AI config
    const res = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not configured");
  });

  test("returns 400 when recording has no transcription", async () => {
    // Create a recording WITHOUT transcribing
    const rec = await createRecording("Summarize No Transcription");
    createdIds.push(rec.id);

    // Set AI config so it doesn't fail on that check
    await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "anthropic",
        apiKey: "sk-test-key",
        model: "claude-sonnet-4-20250514",
      }),
    });

    const res = await fetch(
      `${BASE_URL}/api/recordings/${rec.id}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("No transcription");

    // Clean up AI config
    await fetch(`${BASE_URL}/api/settings/ai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "", apiKey: "" }),
    });
  });
});
