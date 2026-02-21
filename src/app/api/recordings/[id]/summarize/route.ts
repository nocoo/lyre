/**
 * POST /api/recordings/[id]/summarize — Generate AI summary from transcription.
 *
 * Reads the transcription full text, calls the configured LLM provider,
 * and stores the result in recordings.ai_summary.
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
} from "@/services/ai";
import { generateText } from "ai";

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
    });

    const client = createAiClient(config);
    const prompt = buildSummaryPrompt(transcription.fullText);

    const { text } = await generateText({
      model: client(config.model),
      prompt,
      maxOutputTokens: 2048,
    });

    const summary = text.trim();

    // Save to database
    recordingsRepo.update(id, { aiSummary: summary });

    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[summarize] Failed for recording ${id}:`, message);
    return NextResponse.json(
      { error: `Failed to generate summary: ${message}` },
      { status: 502 },
    );
  }
}
