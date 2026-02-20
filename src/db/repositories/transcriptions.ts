/**
 * Transcription repository.
 *
 * Handles CRUD for the transcriptions table.
 * Sentences are stored as JSON arrays in the database.
 */

import { eq } from "drizzle-orm";
import { db } from "../index";
import { transcriptions, type DbTranscription } from "../schema";
import type { TranscriptionSentence } from "@/lib/types";

/** Parse sentences JSON string to array */
function parseSentences(sentencesJson: string): TranscriptionSentence[] {
  try {
    const parsed: unknown = JSON.parse(sentencesJson);
    return Array.isArray(parsed) ? (parsed as TranscriptionSentence[]) : [];
  } catch {
    return [];
  }
}

export const transcriptionsRepo = {
  findById(id: string): DbTranscription | undefined {
    return db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, id))
      .get();
  },

  findByRecordingId(recordingId: string): DbTranscription | undefined {
    return db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.recordingId, recordingId))
      .get();
  },

  create(data: {
    id: string;
    recordingId: string;
    jobId: string;
    fullText: string;
    sentences: TranscriptionSentence[];
    language: string | null;
  }): DbTranscription {
    const now = Date.now();
    return db
      .insert(transcriptions)
      .values({
        ...data,
        sentences: JSON.stringify(data.sentences),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  },

  update(
    id: string,
    data: Partial<{
      fullText: string;
      sentences: TranscriptionSentence[];
      language: string | null;
    }>,
  ): DbTranscription | undefined {
    const updateData: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    if (data.fullText !== undefined) updateData.fullText = data.fullText;
    if (data.sentences !== undefined)
      updateData.sentences = JSON.stringify(data.sentences);
    if (data.language !== undefined) updateData.language = data.language;

    return db
      .update(transcriptions)
      .set(updateData)
      .where(eq(transcriptions.id, id))
      .returning()
      .get();
  },

  delete(id: string): boolean {
    const result = db
      .delete(transcriptions)
      .where(eq(transcriptions.id, id))
      .run() as unknown as { changes: number };
    return result.changes > 0;
  },

  deleteByRecordingId(recordingId: string): boolean {
    const result = db
      .delete(transcriptions)
      .where(eq(transcriptions.recordingId, recordingId))
      .run() as unknown as { changes: number };
    return result.changes > 0;
  },

  /** Helper: parse sentences from a DB row */
  parseSentences,
};
