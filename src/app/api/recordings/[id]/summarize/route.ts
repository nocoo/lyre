/**
 * POST /api/recordings/[id]/summarize — Generate AI summary from transcription.
 *
 * Returns a streaming text response so the client can display the summary
 * as it is being generated. On completion, saves the final summary to
 * recordings.ai_summary in the database.
 *
 * Error responses (4xx) are returned as JSON before streaming starts.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import {
  recordingsRepo,
  transcriptionsRepo,
  settingsRepo,
} from "@/db/repositories";
import {
  resolveAiConfig,
  createAiClient,
  buildSummaryPrompt,
  type AiProvider,
  type SdkType,
} from "@/services/ai";
import { streamText } from "ai";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const recording = recordingsRepo.findById(id);

  if (!recording || recording.userId !== user.id) {
    return NextResponse.json(
      { error: "Recording not found" },
      { status: 404 },
    );
  }

  // Check transcription exists
  const transcription = transcriptionsRepo.findByRecordingId(id);
  if (!transcription || !transcription.fullText) {
    return NextResponse.json(
      { error: "No transcription available for this recording" },
      { status: 400 },
    );
  }

  // Load AI settings
  const all = settingsRepo.findByUserId(user.id);
  const map = new Map(all.map((s) => [s.key, s.value]));
  const provider = map.get("ai.provider") ?? "";
  const apiKey = map.get("ai.apiKey") ?? "";
  const model = map.get("ai.model") ?? "";
  const baseURL = map.get("ai.baseURL") ?? "";
  const sdkType = map.get("ai.sdkType") ?? "";

  if (!provider || !apiKey) {
    return NextResponse.json(
      { error: "AI is not configured. Please set up AI in Settings." },
      { status: 400 },
    );
  }

  try {
    const config = resolveAiConfig({
      provider: provider as AiProvider,
      apiKey,
      model,
      baseURL: baseURL || undefined,
      sdkType: (sdkType || undefined) as SdkType | undefined,
    });

    const client = createAiClient(config);
    const prompt = buildSummaryPrompt(transcription.fullText);

    const result = streamText({
      model: client(config.model),
      prompt,
      maxOutputTokens: 2048,
      onFinish({ text }) {
        // Save the completed summary to the database
        const summary = text.trim();
        if (summary) {
          recordingsRepo.update(id, { aiSummary: summary });
        }
      },
    });

    // Ensure onFinish fires even if client disconnects
    result.consumeStream();

    return result.toTextStreamResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[summarize] Failed for recording ${id}:`, message);
    return NextResponse.json(
      { error: `Failed to generate summary: ${message}` },
      { status: 502 },
    );
  }
}
