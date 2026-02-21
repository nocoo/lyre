import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  parseTranscriptionResult,
  createMockAsrProvider,
  createRealAsrProvider,
  type AsrTranscriptionResult,
} from "@/services/asr";

// ── parseTranscriptionResult ──

describe("parseTranscriptionResult", () => {
  const makeResult = (
    overrides: Partial<AsrTranscriptionResult> = {},
  ): AsrTranscriptionResult => ({
    file_url: "https://oss.example.com/test.mp3",
    audio_info: { format: "mp3", sample_rate: 48000 },
    transcripts: [
      {
        channel_id: 0,
        text: "Hello world. Goodbye.",
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
            end_time: 4000,
            language: "en",
            emotion: "happy",
            text: "Goodbye.",
            words: [
              {
                begin_time: 2500,
                end_time: 4000,
                text: "Goodbye",
                punctuation: ".",
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  });

  test("extracts fullText from first transcript channel", () => {
    const result = parseTranscriptionResult(makeResult());
    expect(result.fullText).toBe("Hello world. Goodbye.");
  });

  test("maps sentences without word-level data", () => {
    const result = parseTranscriptionResult(makeResult());
    expect(result.sentences).toHaveLength(2);
    expect(result.sentences[0]).toEqual({
      sentenceId: 0,
      beginTime: 0,
      endTime: 2000,
      text: "Hello world.",
      language: "en",
      emotion: "neutral",
    });
    expect(result.sentences[1]).toEqual({
      sentenceId: 1,
      beginTime: 2500,
      endTime: 4000,
      text: "Goodbye.",
      language: "en",
      emotion: "happy",
    });
    // Verify no 'words' property leaked through
    for (const s of result.sentences) {
      expect(s).not.toHaveProperty("words");
    }
  });

  test("detects dominant language", () => {
    const result = parseTranscriptionResult(makeResult());
    expect(result.language).toBe("en");
  });

  test("detects dominant language with mixed languages", () => {
    const raw = makeResult();
    raw.transcripts[0]!.sentences = [
      {
        sentence_id: 0,
        begin_time: 0,
        end_time: 1000,
        language: "zh",
        emotion: "neutral",
        text: "Ni hao",
        words: [],
      },
      {
        sentence_id: 1,
        begin_time: 1000,
        end_time: 2000,
        language: "en",
        emotion: "neutral",
        text: "Hello",
        words: [],
      },
      {
        sentence_id: 2,
        begin_time: 2000,
        end_time: 3000,
        language: "zh",
        emotion: "neutral",
        text: "Shi jie",
        words: [],
      },
    ];
    const result = parseTranscriptionResult(raw);
    expect(result.language).toBe("zh");
  });

  test("preserves audio_info fields", () => {
    const result = parseTranscriptionResult(makeResult());
    expect(result.audioFormat).toBe("mp3");
    expect(result.audioSampleRate).toBe(48000);
  });

  test("handles empty transcripts array", () => {
    const result = parseTranscriptionResult(makeResult({ transcripts: [] }));
    expect(result.fullText).toBe("");
    expect(result.language).toBeNull();
    expect(result.sentences).toEqual([]);
    expect(result.audioFormat).toBe("mp3");
    expect(result.audioSampleRate).toBe(48000);
  });

  test("handles transcript with zero sentences", () => {
    const raw = makeResult();
    raw.transcripts[0]!.sentences = [];
    raw.transcripts[0]!.text = "";
    const result = parseTranscriptionResult(raw);
    expect(result.fullText).toBe("");
    expect(result.language).toBeNull();
    expect(result.sentences).toEqual([]);
  });

  test("uses only first transcript channel when multiple exist", () => {
    const raw = makeResult();
    raw.transcripts.push({
      channel_id: 1,
      text: "Channel 1 text",
      sentences: [
        {
          sentence_id: 0,
          begin_time: 0,
          end_time: 1000,
          language: "fr",
          emotion: "neutral",
          text: "Bonjour",
          words: [],
        },
      ],
    });
    const result = parseTranscriptionResult(raw);
    expect(result.fullText).toBe("Hello world. Goodbye.");
    expect(result.language).toBe("en");
  });

  test("handles single sentence for language detection", () => {
    const raw = makeResult();
    raw.transcripts[0]!.sentences = [
      {
        sentence_id: 0,
        begin_time: 0,
        end_time: 1000,
        language: "ja",
        emotion: "neutral",
        text: "Konnichiwa",
        words: [],
      },
    ];
    const result = parseTranscriptionResult(raw);
    expect(result.language).toBe("ja");
  });

  test("preserves sentence timing in milliseconds", () => {
    const result = parseTranscriptionResult(makeResult());
    expect(result.sentences[0]!.beginTime).toBe(0);
    expect(result.sentences[0]!.endTime).toBe(2000);
    expect(result.sentences[1]!.beginTime).toBe(2500);
    expect(result.sentences[1]!.endTime).toBe(4000);
  });
});

// ── createMockAsrProvider ──

describe("createMockAsrProvider", () => {
  test("submit returns PENDING status with a task_id", async () => {
    const provider = createMockAsrProvider();
    const result = await provider.submit("https://example.com/audio.mp3");
    expect(result.output.task_status).toBe("PENDING");
    expect(result.output.task_id).toMatch(/^mock-task-/);
    expect(result.request_id).toBeDefined();
  });

  test("submit generates unique task_ids", async () => {
    const provider = createMockAsrProvider();
    const r1 = await provider.submit("https://example.com/1.mp3");
    const r2 = await provider.submit("https://example.com/2.mp3");
    expect(r1.output.task_id).not.toBe(r2.output.task_id);
  });

  test("default poll transitions: PENDING -> RUNNING -> SUCCEEDED", async () => {
    const provider = createMockAsrProvider();
    const {
      output: { task_id },
    } = await provider.submit("https://x.com/a.mp3");

    const p1 = await provider.poll(task_id);
    expect(p1.output.task_status).toBe("RUNNING");

    const p2 = await provider.poll(task_id);
    expect(p2.output.task_status).toBe("RUNNING");

    const p3 = await provider.poll(task_id);
    expect(p3.output.task_status).toBe("SUCCEEDED");
    expect(p3.output.result?.transcription_url).toContain(task_id);
    expect(p3.usage?.seconds).toBe(42);
  });

  test("custom pollsUntilRunning delays RUNNING transition", async () => {
    const provider = createMockAsrProvider({
      pollsUntilRunning: 3,
      pollsUntilDone: 5,
    });
    const {
      output: { task_id },
    } = await provider.submit("https://x.com/a.mp3");

    expect((await provider.poll(task_id)).output.task_status).toBe("PENDING");
    expect((await provider.poll(task_id)).output.task_status).toBe("PENDING");
    expect((await provider.poll(task_id)).output.task_status).toBe("RUNNING");
    expect((await provider.poll(task_id)).output.task_status).toBe("RUNNING");
    expect((await provider.poll(task_id)).output.task_status).toBe(
      "SUCCEEDED",
    );
  });

  test("simulateFailure returns FAILED at pollsUntilDone", async () => {
    const provider = createMockAsrProvider({
      pollsUntilDone: 2,
      simulateFailure: true,
      failureMessage: "OOM error",
    });
    const {
      output: { task_id },
    } = await provider.submit("https://x.com/a.mp3");

    const p1 = await provider.poll(task_id);
    expect(p1.output.task_status).toBe("RUNNING");

    const p2 = await provider.poll(task_id);
    expect(p2.output.task_status).toBe("FAILED");
    expect(p2.output.message).toBe("OOM error");
    expect(p2.output.result).toBeUndefined();
  });

  test("simulateFailure uses default failure message", async () => {
    const provider = createMockAsrProvider({
      pollsUntilDone: 1,
      pollsUntilRunning: 0,
      simulateFailure: true,
    });
    const {
      output: { task_id },
    } = await provider.submit("https://x.com/a.mp3");

    const p = await provider.poll(task_id);
    expect(p.output.task_status).toBe("FAILED");
    expect(p.output.message).toBe("Mock transcription failure");
  });

  test("fetchResult returns default mock result", async () => {
    const provider = createMockAsrProvider();
    const result = await provider.fetchResult(
      "https://mock.example.com/result.json",
    );
    expect(result.transcripts).toHaveLength(1);
    expect(result.transcripts[0]!.text).toBe(
      "Hello world. This is a test transcription.",
    );
    expect(result.transcripts[0]!.sentences).toHaveLength(2);
    expect(result.audio_info.format).toBe("mp3");
  });

  test("fetchResult returns custom mock result when provided", async () => {
    const customResult: AsrTranscriptionResult = {
      file_url: "https://custom.example.com/audio.wav",
      audio_info: { format: "wav", sample_rate: 16000 },
      transcripts: [
        {
          channel_id: 0,
          text: "Custom text",
          sentences: [
            {
              sentence_id: 0,
              begin_time: 0,
              end_time: 500,
              language: "zh",
              emotion: "happy",
              text: "Custom text",
              words: [],
            },
          ],
        },
      ],
    };
    const provider = createMockAsrProvider({ mockResult: customResult });
    const result = await provider.fetchResult("any-url");
    expect(result.file_url).toBe("https://custom.example.com/audio.wav");
    expect(result.audio_info.format).toBe("wav");
    expect(result.transcripts[0]!.text).toBe("Custom text");
  });

  test("independent task tracking (multiple tasks do not interfere)", async () => {
    const provider = createMockAsrProvider({
      pollsUntilRunning: 1,
      pollsUntilDone: 2,
    });

    const r1 = await provider.submit("https://x.com/1.mp3");
    const r2 = await provider.submit("https://x.com/2.mp3");
    const t1 = r1.output.task_id;
    const t2 = r2.output.task_id;

    expect((await provider.poll(t1)).output.task_status).toBe("RUNNING");
    expect((await provider.poll(t2)).output.task_status).toBe("RUNNING");
    expect((await provider.poll(t1)).output.task_status).toBe("SUCCEEDED");
    expect((await provider.poll(t2)).output.task_status).toBe("SUCCEEDED");
  });

  test("poll unknown taskId starts from count=1", async () => {
    const provider = createMockAsrProvider({
      pollsUntilRunning: 2,
      pollsUntilDone: 3,
    });
    const p = await provider.poll("unknown-task");
    expect(p.output.task_status).toBe("PENDING");
  });

  test("SUCCEEDED response includes timing fields", async () => {
    const provider = createMockAsrProvider({
      pollsUntilDone: 1,
      pollsUntilRunning: 0,
    });
    const {
      output: { task_id },
    } = await provider.submit("https://x.com/a.mp3");
    const p = await provider.poll(task_id);
    expect(p.output.task_status).toBe("SUCCEEDED");
    expect(p.output.submit_time).toBeDefined();
    expect(p.output.scheduled_time).toBeDefined();
    expect(p.output.end_time).toBeDefined();
  });

  test("full flow: submit -> poll -> fetch -> parse", async () => {
    const provider = createMockAsrProvider({
      pollsUntilDone: 2,
      pollsUntilRunning: 1,
    });
    const submitRes = await provider.submit("https://example.com/audio.mp3");
    expect(submitRes.output.task_status).toBe("PENDING");

    const taskId = submitRes.output.task_id;

    let status = "PENDING";
    let transcriptionUrl = "";
    while (status !== "SUCCEEDED") {
      const pollRes = await provider.poll(taskId);
      status = pollRes.output.task_status;
      if (pollRes.output.result) {
        transcriptionUrl = pollRes.output.result.transcription_url;
      }
    }
    expect(transcriptionUrl).toBeTruthy();

    const raw = await provider.fetchResult(transcriptionUrl);
    expect(raw.transcripts.length).toBeGreaterThan(0);

    const parsed = parseTranscriptionResult(raw);
    expect(parsed.fullText).toBe("Hello world. This is a test transcription.");
    expect(parsed.sentences).toHaveLength(2);
    expect(parsed.language).toBe("en");
    expect(parsed.audioFormat).toBe("mp3");
  });
});

// ── createRealAsrProvider ──

describe("createRealAsrProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Will be overridden per test
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("submit sends correct request to DashScope API", async () => {
    const capturedRequests: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push({ url: url.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({
          request_id: "test-req-id",
          output: { task_id: "test-task-id", task_status: "PENDING" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createRealAsrProvider("sk-test-api-key");
    const result = await provider.submit("https://oss.example.com/audio.mp3");

    expect(result.output.task_id).toBe("test-task-id");
    expect(result.output.task_status).toBe("PENDING");

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0]!;
    expect(req.url).toContain("/services/audio/asr/transcription");
    expect(req.init.method).toBe("POST");

    const headers = req.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-api-key");
    expect(headers["X-DashScope-Async"]).toBe("enable");

    const body = JSON.parse(req.init.body as string) as {
      model: string;
      input: { file_url: string };
      parameters: { language_hints: string[]; enable_words: boolean };
    };
    expect(body.model).toBe("qwen3-asr-flash-filetrans");
    expect(body.input.file_url).toBe("https://oss.example.com/audio.mp3");
    expect(body.parameters.enable_words).toBe(true);
  });

  test("submit throws on non-ok response", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    const provider = createRealAsrProvider("bad-key");
    await expect(
      provider.submit("https://oss.example.com/audio.mp3"),
    ).rejects.toThrow("DashScope submit failed (401)");
  });

  test("poll sends correct request", async () => {
    const capturedRequests: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push({ url: url.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({
          request_id: "poll-req-id",
          output: {
            task_id: "task-123",
            task_status: "RUNNING",
            submit_time: "2026-02-20 10:00:00.000",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createRealAsrProvider("sk-test-key");
    const result = await provider.poll("task-123");

    expect(result.output.task_status).toBe("RUNNING");
    expect(capturedRequests[0]!.url).toContain("/tasks/task-123");

    const headers = capturedRequests[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-key");
  });

  test("poll throws on non-ok response", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const provider = createRealAsrProvider("sk-test-key");
    await expect(provider.poll("bad-task-id")).rejects.toThrow(
      "DashScope poll failed (404)",
    );
  });

  test("fetchResult fetches transcription URL without auth header", async () => {
    const capturedRequests: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push({ url: url.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({
          file_url: "https://oss.example.com/audio.mp3",
          audio_info: { format: "mp3", sample_rate: 16000 },
          transcripts: [
            { channel_id: 0, text: "Test", sentences: [] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createRealAsrProvider("sk-test-key");
    const result = await provider.fetchResult(
      "https://dashscope-result.oss.example.com/result.json",
    );

    expect(result.transcripts[0]!.text).toBe("Test");
    expect(capturedRequests[0]!.url).toBe(
      "https://dashscope-result.oss.example.com/result.json",
    );
    // fetchResult should NOT send Authorization header (presigned URL)
    expect(capturedRequests[0]!.init.headers).toBeUndefined();
  });

  test("fetchResult throws on non-ok response", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Expired", { status: 403 });
    }) as typeof fetch;

    const provider = createRealAsrProvider("sk-test-key");
    await expect(
      provider.fetchResult("https://expired-url.example.com"),
    ).rejects.toThrow("Failed to fetch transcription result (403)");
  });
});
