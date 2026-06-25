/**
 * Phase 0C parser tests — pin the multi-track behaviour of
 * `parseTranscriptionResult` so the production recorder rewrite
 * (task #4) can rely on every track surfacing in the persisted
 * transcript.
 */
import { describe, expect, it } from "vitest";
import { parseTranscriptionResult } from "../../services/asr";
import { SENTENCE_ID_CHANNEL_STRIDE } from "../../contracts/recordings";

const AUDIO_INFO = { format: "m4a", sample_rate: 48_000 };

describe("parseTranscriptionResult", () => {
  it("returns empty result when there are no transcripts", () => {
    const result = parseTranscriptionResult({
      file_url: "f",
      audio_info: AUDIO_INFO,
      transcripts: [],
    });
    expect(result.fullText).toBe("");
    expect(result.language).toBeNull();
    expect(result.sentences).toEqual([]);
  });

  it("preserves a single-channel result with raw sentence_ids and the original full text", () => {
    const result = parseTranscriptionResult({
      file_url: "f",
      audio_info: AUDIO_INFO,
      transcripts: [
        {
          channel_id: 0,
          text: "hello",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 0,
              end_time: 500,
              language: "en",
              emotion: "neutral",
              text: "hello",
              words: [],
            },
          ],
        },
      ],
    });
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]?.sentenceId).toBe(0);
    expect(result.sentences[0]?.channelId).toBe(0);
    expect(result.fullText).toBe("hello");
    expect(result.language).toBe("en");
  });

  it("merges sentences from every channel and assigns composite sentenceIds", () => {
    const result = parseTranscriptionResult({
      file_url: "f",
      audio_info: AUDIO_INFO,
      transcripts: [
        {
          channel_id: 0,
          text: "云计算 分布式",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 0,
              end_time: 500,
              language: "zh",
              emotion: "neutral",
              text: "云计算",
              words: [],
            },
            {
              sentence_id: 1,
              begin_time: 1_000,
              end_time: 1_500,
              language: "zh",
              emotion: "neutral",
              text: "分布式",
              words: [],
            },
          ],
        },
        {
          channel_id: 1,
          text: "机器学习 神经网络",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 500,
              end_time: 900,
              language: "zh",
              emotion: "neutral",
              text: "机器学习",
              words: [],
            },
            {
              sentence_id: 1,
              begin_time: 1_500,
              end_time: 2_000,
              language: "zh",
              emotion: "neutral",
              text: "神经网络",
              words: [],
            },
          ],
        },
      ],
    });
    // Sentences come back sorted by beginTime; channel 0 sentenceIds
    // stay as raw values, channel 1 sentenceIds bump by the stride so
    // there are no collisions.
    expect(result.sentences.map((s) => s.text)).toEqual([
      "云计算",
      "机器学习",
      "分布式",
      "神经网络",
    ]);
    expect(result.sentences.map((s) => s.channelId)).toEqual([0, 1, 0, 1]);
    expect(result.sentences.map((s) => s.sentenceId)).toEqual([
      0,
      SENTENCE_ID_CHANNEL_STRIDE,
      1,
      SENTENCE_ID_CHANNEL_STRIDE + 1,
    ]);
    // fullText rebuilt from the merged sentence stream so channel 1
    // tokens are not lost.
    expect(result.fullText).toBe("云计算 机器学习 分布式 神经网络");
    expect(result.language).toBe("zh");
  });

  it("breaks beginTime ties on (channelId, sentenceId) deterministically", () => {
    const result = parseTranscriptionResult({
      file_url: "f",
      audio_info: AUDIO_INFO,
      transcripts: [
        {
          channel_id: 1,
          text: "b",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 1_000,
              end_time: 1_500,
              language: "zh",
              emotion: "neutral",
              text: "B",
              words: [],
            },
          ],
        },
        {
          channel_id: 0,
          text: "a",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 1_000,
              end_time: 1_500,
              language: "zh",
              emotion: "neutral",
              text: "A",
              words: [],
            },
          ],
        },
      ],
    });
    // Same beginTime — lower channelId wins, so channel 0 comes first.
    expect(result.sentences.map((s) => s.text)).toEqual(["A", "B"]);
    expect(result.sentences.map((s) => s.channelId)).toEqual([0, 1]);
  });

  it("computes dominant language from the merged sentence stream", () => {
    const result = parseTranscriptionResult({
      file_url: "f",
      audio_info: AUDIO_INFO,
      transcripts: [
        {
          channel_id: 0,
          text: "en1 en2",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 0,
              end_time: 100,
              language: "en",
              emotion: "neutral",
              text: "en1",
              words: [],
            },
            {
              sentence_id: 1,
              begin_time: 200,
              end_time: 300,
              language: "en",
              emotion: "neutral",
              text: "en2",
              words: [],
            },
          ],
        },
        {
          channel_id: 1,
          text: "zh1",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 100,
              end_time: 150,
              language: "zh",
              emotion: "neutral",
              text: "zh1",
              words: [],
            },
          ],
        },
      ],
    });
    // 2 en + 1 zh across the merged stream → dominant language is en
    // even though the first transcript would have decided that alone.
    expect(result.language).toBe("en");
  });
});
