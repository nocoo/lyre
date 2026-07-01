import { Hono } from "hono";
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
  transcribeRecordingHandler,
  type ListRecordingsInput,
} from "@lyre/api/handlers/recordings";
import { makeRepos } from "@lyre/api/db/repositories";
import {
  resolveAiConfig,
  createAiModel,
  buildSummaryPrompt,
  type AiProvider,
  type SdkType,
} from "@lyre/api/services/ai";
import { streamText } from "ai";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const recordings = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

recordings.get("/", async (c) => {
  const q = c.req.query();
  const input: ListRecordingsInput = {
    query: q.query ?? null,
    status: q.status ?? null,
    sortBy: q.sortBy ?? null,
    sortDir: q.sortDir ?? null,
    page: q.page ?? null,
    pageSize: q.pageSize ?? null,
    folderId: q.folderId ?? null,
  };
  return toResponse(c, await listRecordingsHandler(c.get("runtime"), input));
});

recordings.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, await createRecordingHandler(c.get("runtime"), body));
});

recordings.post("/batch-delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(
    c,
    await batchDeleteRecordingsHandler(c.get("runtime"), body),
  );
});

recordings.delete("/batch", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(
    c,
    await batchDeleteRecordingsHandler(c.get("runtime"), body),
  );
});

recordings.get("/:id", async (c) =>
  toResponse(
    c,
    await getRecordingHandler(c.get("runtime"), c.req.param("id")),
  ),
);

recordings.put("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(
    c,
    await updateRecordingHandler(c.get("runtime"), c.req.param("id"), body),
  );
});

recordings.delete("/:id", async (c) =>
  toResponse(
    c,
    await deleteRecordingHandler(c.get("runtime"), c.req.param("id")),
  ),
);

recordings.get("/:id/play-url", async (c) =>
  toResponse(c, await playUrlHandler(c.get("runtime"), c.req.param("id"))),
);

recordings.get("/:id/download-url", async (c) =>
  toResponse(c, await downloadUrlHandler(c.get("runtime"), c.req.param("id"))),
);

recordings.get("/:id/words", async (c) =>
  toResponse(c, await wordsHandler(c.get("runtime"), c.req.param("id"))),
);

recordings.post("/:id/transcribe", async (c) =>
  toResponse(
    c,
    await transcribeRecordingHandler(c.get("runtime"), c.req.param("id")),
  ),
);

/**
 * Streaming AI summarize. Bypasses HandlerResponse because streamText
 * needs to return a native streaming Response.
 *
 * Lifecycle mirrored to `recordings.aiSummaryStatus`:
 *   entry            → status=running, error=null, aiSummary=null
 *   onFinish(text)   → status=succeeded, aiSummary=text
 *   onError / throw  → status=failed,   aiSummaryError=message
 *
 * Errors that surface before the stream starts return JSON 4xx/5xx.
 * Errors that occur mid-stream flow through `onError` and are persisted
 * to the DB — the client detects them by polling GET /recordings/:id.
 */
recordings.post("/:id/summarize", async (c) => {
  const ctx = c.get("runtime");
  if (!ctx.user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const repos = makeRepos(ctx.db);
  const recording = await repos.recordings.findById(id);
  if (!recording || recording.userId !== ctx.user.id) {
    return c.json({ error: "Recording not found" }, 404);
  }
  const transcription = await repos.transcriptions.findByRecordingId(id);
  if (!transcription || !transcription.fullText) {
    return c.json(
      { error: "No transcription available for this recording" },
      400,
    );
  }
  const all = await repos.settings.findByUserId(ctx.user.id);
  const map = new Map(all.map((s) => [s.key, s.value]));
  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";
  const baseURL = map.get("ai.baseURL") ?? "";
  const sdkType = map.get("ai.sdkType") ?? "";
  const rawAuth = map.get("ai.authType") ?? "";
  const authType =
    rawAuth === "bearer" || rawAuth === "apiKey" ? rawAuth : undefined;
  if (!provider || !apiKey) {
    return c.json(
      { error: "AI is not configured. Please set up AI in Settings." },
      400,
    );
  }

  // Config parsing errors are user-facing 400s — no status update yet
  // because we haven't started a run.
  let client;
  try {
    const config = resolveAiConfig({
      provider: provider as AiProvider,
      apiKey,
      model,
      ...(baseURL ? { baseURL } : {}),
      ...(sdkType ? { sdkType: sdkType as SdkType } : {}),
      ...(authType ? { authType } : {}),
    });
    client = createAiModel(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: `AI configuration invalid: ${message}` }, 400);
  }

  // We're committed: mark the run in-flight and clear any prior state.
  await repos.recordings.update(id, {
    aiSummaryStatus: "running",
    aiSummaryError: null,
    aiSummary: null,
  });

  try {
    const prompt = buildSummaryPrompt(transcription.fullText);
    const result = streamText({
      model: client,
      prompt,
      maxOutputTokens: 2048,
      async onFinish({ text }: { text: string }) {
        const summary = text.trim();
        if (!summary) {
          await repos.recordings.update(id, {
            aiSummaryStatus: "failed",
            aiSummaryError: "AI returned an empty response",
            aiSummary: null,
          });
          return;
        }
        await repos.recordings.update(id, {
          aiSummary: summary,
          aiSummaryStatus: "succeeded",
          aiSummaryError: null,
        });
      },
      async onError({ error }: { error: unknown }) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown error");
        console.warn(`[summarize] Stream error for ${id}:`, message);
        await repos.recordings.update(id, {
          aiSummaryStatus: "failed",
          aiSummaryError: message,
          aiSummary: null,
        });
      },
    });
    result.consumeStream();
    return result.toTextStreamResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[summarize] Failed for recording ${id}:`, message);
    await repos.recordings.update(id, {
      aiSummaryStatus: "failed",
      aiSummaryError: message,
      aiSummary: null,
    });
    return c.json({ error: `Failed to generate summary: ${message}` }, 502);
  }
});
