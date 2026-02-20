/**
 * ASR (Automatic Speech Recognition) Service
 *
 * Integrates with Aliyun DashScope async file-transcription API.
 * Architecture:
 *   - AsrProvider interface: abstracts the HTTP calls (mock vs real)
 *   - submitJob / pollJob: thin wrappers that call the provider
 *   - parseTranscriptionResult: transforms raw API JSON into domain types
 *
 * API flow:
 *   1. POST submit → { task_id, task_status: "PENDING" }
 *   2. GET  poll   → { task_status: "RUNNING" | "SUCCEEDED" | "FAILED", ... }
 *   3. On SUCCEEDED: fetch transcription_url → full JSON with sentences
 *
 * The raw result JSON (potentially large, with word-level timing) is archived
 * to OSS under `results/{taskId}/transcription.json`. Only sentence-level
 * data is stored in the database.
 */

import type { TranscriptionSentence } from "@/lib/types";

// ── DashScope API response types ──

export interface AsrSubmitResponse {
  request_id: string;
  output: {
    task_id: string;
    task_status: "PENDING";
  };
}

export interface AsrPollResponse {
  request_id: string;
  output: {
    task_id: string;
    task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    submit_time?: string;
    scheduled_time?: string;
    end_time?: string;
    result?: {
      transcription_url: string;
    };
    message?: string; // error message on FAILED
  };
  usage?: {
    seconds: number;
  };
}

export interface AsrTranscriptionWord {
  begin_time: number;
  end_time: number;
  text: string;
  punctuation: string;
}

export interface AsrTranscriptionSentence {
  sentence_id: number;
  begin_time: number;
  end_time: number;
  language: string;
  emotion: string;
  text: string;
  words: AsrTranscriptionWord[];
}

export interface AsrTranscriptionResult {
  file_url: string;
  audio_info: {
    format: string;
    sample_rate: number;
  };
  transcripts: Array<{
    channel_id: number;
    text: string;
    sentences: AsrTranscriptionSentence[];
  }>;
}

// ── Parsed result (domain-level, no words) ──

export interface ParsedAsrResult {
  fullText: string;
  language: string | null;
  sentences: TranscriptionSentence[];
  audioFormat: string;
  audioSampleRate: number;
}

// ── Provider interface ──

export interface AsrProvider {
  /**
   * Submit a new transcription job.
   * @param fileUrl - Public downloadable URL of the audio file
   * @returns Submit response with task_id
   */
  submit(fileUrl: string): Promise<AsrSubmitResponse>;

  /**
   * Poll a transcription job status.
   * @param taskId - The task_id returned by submit
   * @returns Current job status
   */
  poll(taskId: string): Promise<AsrPollResponse>;

  /**
   * Fetch the full transcription result JSON.
   * @param transcriptionUrl - The transcription_url from the poll response
   * @returns Raw transcription result
   */
  fetchResult(transcriptionUrl: string): Promise<AsrTranscriptionResult>;
}

// ── Parse raw result to domain model ──

/**
 * Transform the raw DashScope transcription JSON into domain types.
 * Takes the first transcript channel. Strips word-level data (too large for DB).
 * Detects dominant language from sentences.
 */
export function parseTranscriptionResult(
  raw: AsrTranscriptionResult,
): ParsedAsrResult {
  const transcript = raw.transcripts[0];
  if (!transcript) {
    return {
      fullText: "",
      language: null,
      sentences: [],
      audioFormat: raw.audio_info.format,
      audioSampleRate: raw.audio_info.sample_rate,
    };
  }

  const sentences: TranscriptionSentence[] = transcript.sentences.map((s) => ({
    sentenceId: s.sentence_id,
    beginTime: s.begin_time,
    endTime: s.end_time,
    text: s.text,
    language: s.language,
    emotion: s.emotion,
  }));

  // Detect dominant language (most frequent among sentences)
  const langCounts = new Map<string, number>();
  for (const s of sentences) {
    langCounts.set(s.language, (langCounts.get(s.language) ?? 0) + 1);
  }
  let dominantLang: string | null = null;
  let maxCount = 0;
  for (const [lang, count] of langCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantLang = lang;
    }
  }

  return {
    fullText: transcript.text,
    language: dominantLang,
    sentences,
    audioFormat: raw.audio_info.format,
    audioSampleRate: raw.audio_info.sample_rate,
  };
}

// ── Mock provider ──

/**
 * Mock ASR provider for development and testing.
 *
 * Simulates the async DashScope flow:
 *   - submit() returns a fake task_id immediately
 *   - poll() returns PENDING → RUNNING → SUCCEEDED after configured delays
 *   - fetchResult() returns data from the example output
 *
 * Poll behavior:
 *   - First call: PENDING (or RUNNING)
 *   - pollsUntilRunning calls: RUNNING
 *   - After pollsUntilDone calls total: SUCCEEDED with transcription_url
 *
 * This allows UI to exercise the full state machine without real API calls.
 */

interface MockAsrProviderOptions {
  /** How many polls before transitioning from PENDING to RUNNING (default: 1) */
  pollsUntilRunning?: number;
  /** How many total polls before SUCCEEDED (default: 3) */
  pollsUntilDone?: number;
  /** Whether to simulate a FAILED result (default: false) */
  simulateFailure?: boolean;
  /** Error message when simulating failure */
  failureMessage?: string;
  /** Static mock result to return (if not provided, uses default) */
  mockResult?: AsrTranscriptionResult;
}

export function createMockAsrProvider(
  options: MockAsrProviderOptions = {},
): AsrProvider {
  const {
    pollsUntilRunning = 1,
    pollsUntilDone = 3,
    simulateFailure = false,
    failureMessage = "Mock transcription failure",
    mockResult,
  } = options;

  // Track poll counts per task
  const pollCounts = new Map<string, number>();

  const defaultMockResult: AsrTranscriptionResult = {
    file_url: "https://mock-oss.example.com/test.mp3",
    audio_info: { format: "mp3", sample_rate: 48000 },
    transcripts: [
      {
        channel_id: 0,
        text: "Hello world. This is a test transcription.",
        sentences: [
          {
            sentence_id: 0,
            begin_time: 0,
            end_time: 2000,
            language: "en",
            emotion: "neutral",
            text: "Hello world.",
            words: [
              { begin_time: 0, end_time: 500, text: "Hello", punctuation: "" },
              {
                begin_time: 600,
                end_time: 2000,
                text: "world",
                punctuation: ".",
              },
            ],
          },
          {
            sentence_id: 1,
            begin_time: 2500,
            end_time: 5000,
            language: "en",
            emotion: "neutral",
            text: "This is a test transcription.",
            words: [
              {
                begin_time: 2500,
                end_time: 2800,
                text: "This",
                punctuation: "",
              },
              {
                begin_time: 2900,
                end_time: 3100,
                text: "is",
                punctuation: "",
              },
              {
                begin_time: 3200,
                end_time: 3300,
                text: "a",
                punctuation: "",
              },
              {
                begin_time: 3400,
                end_time: 3700,
                text: "test",
                punctuation: "",
              },
              {
                begin_time: 3800,
                end_time: 5000,
                text: "transcription",
                punctuation: ".",
              },
            ],
          },
        ],
      },
    ],
  };

  return {
    async submit(_fileUrl: string): Promise<AsrSubmitResponse> {
      const taskId = `mock-task-${crypto.randomUUID()}`;
      pollCounts.set(taskId, 0);
      return {
        request_id: crypto.randomUUID(),
        output: {
          task_id: taskId,
          task_status: "PENDING",
        },
      };
    },

    async poll(taskId: string): Promise<AsrPollResponse> {
      const count = (pollCounts.get(taskId) ?? 0) + 1;
      pollCounts.set(taskId, count);

      const now = new Date().toISOString().replace("T", " ").slice(0, 23);

      // Determine status based on poll count
      if (simulateFailure && count >= pollsUntilDone) {
        return {
          request_id: crypto.randomUUID(),
          output: {
            task_id: taskId,
            task_status: "FAILED",
            submit_time: now,
            end_time: now,
            message: failureMessage,
          },
        };
      }

      if (count >= pollsUntilDone) {
        return {
          request_id: crypto.randomUUID(),
          output: {
            task_id: taskId,
            task_status: "SUCCEEDED",
            submit_time: now,
            scheduled_time: now,
            end_time: now,
            result: {
              transcription_url: `https://mock-result.example.com/${taskId}.json`,
            },
          },
          usage: { seconds: 42 },
        };
      }

      if (count >= pollsUntilRunning) {
        return {
          request_id: crypto.randomUUID(),
          output: {
            task_id: taskId,
            task_status: "RUNNING",
            submit_time: now,
          },
        };
      }

      return {
        request_id: crypto.randomUUID(),
        output: {
          task_id: taskId,
          task_status: "PENDING",
        },
      };
    },

    async fetchResult(
      _transcriptionUrl: string,
    ): Promise<AsrTranscriptionResult> {
      return mockResult ?? defaultMockResult;
    },
  };
}

// ── TLS-safe fetch helper ──

/**
 * Fetch wrapper that falls back to curl subprocess when Bun's native fetch
 * hits TLS certificate verification errors (e.g. MITM proxies on macOS).
 *
 * On production (Linux/Railway), native fetch works fine.
 * On dev (macOS with system proxy), curl bypasses the issue.
 */
async function safeFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : String(error);
    if (!msg.includes("certificate")) throw error;

    // Fallback to curl
    const args = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30"];
    if (options.method === "POST") args.push("-X", "POST");
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        args.push("-H", `${key}: ${value}`);
      }
    }
    if (options.body) args.push("-d", options.body);
    args.push(url);

    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`curl failed (exit ${exitCode}): ${stderr}`);
    }

    const lines = output.trimEnd().split("\n");
    const statusCode = parseInt(lines.pop()!, 10);
    const body = lines.join("\n");
    return { status: statusCode, body };
  }
}

// ── Real DashScope provider ──

/**
 * Real ASR provider that calls the DashScope async file-transcription API.
 *
 * API endpoints:
 *   - Submit: POST https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription
 *   - Poll:   GET  https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
 *   - Fetch:  GET  transcription_url (presigned OSS URL, no auth needed)
 *
 * Model: qwen3-asr-flash-filetrans
 * Supports audio files up to 12 hours / 2GB.
 */

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";

export function createRealAsrProvider(apiKey: string): AsrProvider {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    async submit(fileUrl: string): Promise<AsrSubmitResponse> {
      const { status, body } = await safeFetch(
        `${DASHSCOPE_BASE_URL}/services/audio/asr/transcription`,
        {
          method: "POST",
          headers: {
            ...headers,
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify({
            model: "qwen3-asr-flash-filetrans",
            input: {
              file_url: fileUrl,
            },
            parameters: {
              language_hints: ["zh", "en"],
            },
          }),
        },
      );

      if (status < 200 || status >= 300) {
        throw new Error(`DashScope submit failed (${status}): ${body}`);
      }

      return JSON.parse(body) as AsrSubmitResponse;
    },

    async poll(taskId: string): Promise<AsrPollResponse> {
      const { status, body } = await safeFetch(
        `${DASHSCOPE_BASE_URL}/tasks/${taskId}`,
        { headers },
      );

      if (status < 200 || status >= 300) {
        throw new Error(`DashScope poll failed (${status}): ${body}`);
      }

      return JSON.parse(body) as AsrPollResponse;
    },

    async fetchResult(
      transcriptionUrl: string,
    ): Promise<AsrTranscriptionResult> {
      // transcription_url is a presigned OSS URL — no auth needed
      const { status, body } = await safeFetch(transcriptionUrl);

      if (status < 200 || status >= 300) {
        throw new Error(
          `Failed to fetch transcription result (${status}): ${body}`,
        );
      }

      return JSON.parse(body) as AsrTranscriptionResult;
    },
  };
}

// ── Service barrel ──

export const asrService = {
  parseTranscriptionResult,
  createMockAsrProvider,
  createRealAsrProvider,
};
