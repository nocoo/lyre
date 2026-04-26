/**
 * Transcription repository factory.
 */

import { eq } from "drizzle-orm";
import { db as defaultDb } from "../index";
import type { LyreDb } from "../types";
import { rowsAffected } from "../drivers/result";
import { transcriptions, type DbTranscription } from "../schema";
import type { TranscriptionSentence } from "../../lib/types";

function parseSentences(sentencesJson: string): TranscriptionSentence[] {
  try {
    const parsed: unknown = JSON.parse(sentencesJson);
    return Array.isArray(parsed) ? (parsed as TranscriptionSentence[]) : [];
  } catch {
    return [];
  }
}

export function makeTranscriptionsRepo(db: LyreDb) {
  return {
    async findById(id: string): Promise<DbTranscription | undefined> {
      return await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.id, id))
        .get();
    },

    async findByRecordingId(
      recordingId: string,
    ): Promise<DbTranscription | undefined> {
      return await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, recordingId))
        .get();
    },

    async create(data: {
      id: string;
      recordingId: string;
      jobId: string;
      fullText: string;
      sentences: TranscriptionSentence[];
      language: string | null;
    }): Promise<DbTranscription> {
      const now = Date.now();
      return await db
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

    async update(
      id: string,
      data: Partial<{
        fullText: string;
        sentences: TranscriptionSentence[];
        language: string | null;
      }>,
    ): Promise<DbTranscription | undefined> {
      const updateData: Record<string, unknown> = { updatedAt: Date.now() };
      if (data.fullText !== undefined) updateData.fullText = data.fullText;
      if (data.sentences !== undefined)
        updateData.sentences = JSON.stringify(data.sentences);
      if (data.language !== undefined) updateData.language = data.language;

      return await db
        .update(transcriptions)
        .set(updateData)
        .where(eq(transcriptions.id, id))
        .returning()
        .get();
    },

    async delete(id: string): Promise<boolean> {
      const result = await db
        .delete(transcriptions)
        .where(eq(transcriptions.id, id))
        .run();
      return rowsAffected(result) > 0;
    },

    async deleteByRecordingId(recordingId: string): Promise<boolean> {
      const result = await db
        .delete(transcriptions)
        .where(eq(transcriptions.recordingId, recordingId))
        .run();
      return rowsAffected(result) > 0;
    },

    parseSentences,
  };
}

export type TranscriptionsRepo = ReturnType<typeof makeTranscriptionsRepo>;

export const transcriptionsRepo: TranscriptionsRepo =
  makeTranscriptionsRepo(defaultDb);
