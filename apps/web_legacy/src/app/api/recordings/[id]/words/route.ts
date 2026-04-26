/**
 * GET /api/recordings/[id]/words
 *
 * Lazy-load word-level timestamp data from the archived raw ASR result on OSS.
 *
 * Flow:
 *   1. Find the latest SUCCEEDED job for the recording
 *   2. Build the OSS key: results/{jobId}/transcription.json
 *   3. Fetch the raw JSON via presigned GET URL
 *   4. Extract only { sentenceId, words[] } for each sentence
 *   5. Return the slim payload to the client
 *
 * The raw JSON can be 1MB+, but the extracted words payload is much smaller
 * (just begin_time, end_time, text, punctuation per word).
 *
 * Results are cached client-side after the first fetch.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo, jobsRepo } from "@/db/repositories";
import { presignGet, makeResultKey } from "@/services/oss";
import type {
  AsrTranscriptionResult,
  AsrTranscriptionWord,
} from "@/services/asr";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Word data per sentence returned to the client */
export interface SentenceWords {
  sentenceId: number;
  words: AsrTranscriptionWord[];
}

export async function GET(_request: NextRequest, context: RouteContext) {
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

  // Find the latest succeeded job
  const job = jobsRepo.findLatestByRecordingId(id);
  if (!job || job.status !== "SUCCEEDED") {
    return NextResponse.json(
      { error: "No completed transcription found" },
      { status: 404 },
    );
  }

  // Fetch the raw result from OSS
  const ossKey = makeResultKey(job.id, "transcription.json");
  const ossUrl = presignGet(ossKey, 300); // 5 min expiry is enough

  try {
    const response = await fetch(ossUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch transcription data from storage" },
        { status: 502 },
      );
    }

    const raw = (await response.json()) as AsrTranscriptionResult;
    const transcript = raw.transcripts[0];

    if (!transcript) {
      return NextResponse.json({ sentences: [] });
    }

    // Extract only the word-level data per sentence
    const sentences: SentenceWords[] = transcript.sentences.map((s) => ({
      sentenceId: s.sentence_id,
      words: s.words.map((w) => ({
        begin_time: w.begin_time,
        end_time: w.end_time,
        text: w.text,
        punctuation: w.punctuation,
      })),
    }));

    return NextResponse.json({ sentences });
  } catch (error) {
    console.error("Failed to load word data:", error);
    return NextResponse.json(
      { error: "Failed to load word data" },
      { status: 500 },
    );
  }
}
