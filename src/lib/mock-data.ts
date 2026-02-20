/**
 * Mock data for development and testing.
 * Provides realistic recordings with various statuses.
 */

import type {
  Recording,
  RecordingDetail,
  Transcription,
  TranscriptionJob,
  TranscriptionSentence,
} from "./types";

const NOW = 1740000000000; // ~2025-02-19 in ms
const DAY = 86_400_000;

// ── Mock sentences ──

const mockSentences: TranscriptionSentence[] = [
  {
    sentenceId: 0,
    beginTime: 0,
    endTime: 3200,
    text: "Welcome to the quarterly product review meeting.",
    language: "en",
    emotion: "neutral",
  },
  {
    sentenceId: 1,
    beginTime: 3200,
    endTime: 7800,
    text: "Today we'll be discussing the progress on our main initiatives and the roadmap for next quarter.",
    language: "en",
    emotion: "neutral",
  },
  {
    sentenceId: 2,
    beginTime: 7800,
    endTime: 12400,
    text: "Let's start with the user growth metrics. We've seen a 23% increase in monthly active users.",
    language: "en",
    emotion: "neutral",
  },
  {
    sentenceId: 3,
    beginTime: 12400,
    endTime: 18200,
    text: "The mobile app retention rate improved significantly, reaching 68% at day-30, which is well above our target.",
    language: "en",
    emotion: "neutral",
  },
  {
    sentenceId: 4,
    beginTime: 18200,
    endTime: 23000,
    text: "Moving on to the technical infrastructure, we completed the migration to the new database cluster last week.",
    language: "en",
    emotion: "neutral",
  },
];

const mockFullText = mockSentences.map((s) => s.text).join(" ");

// ── Mock recordings ──

export const MOCK_RECORDINGS: Recording[] = [
  {
    id: "rec-001",
    userId: "user-001",
    title: "Q4 Product Review Meeting",
    description:
      "Quarterly review covering user growth, retention metrics, and infrastructure updates.",
    fileName: "q4-product-review.mp3",
    fileSize: 15_728_640,
    duration: 1847.5,
    format: "mp3",
    sampleRate: 48000,
    ossKey: "recordings/user-001/rec-001/q4-product-review.mp3",
    tags: ["meeting", "product", "quarterly"],
    status: "completed",
    createdAt: NOW - 7 * DAY,
    updatedAt: NOW - 7 * DAY,
  },
  {
    id: "rec-002",
    userId: "user-001",
    title: "Design Sprint Kickoff",
    description: "Initial brainstorming session for the new dashboard redesign.",
    fileName: "design-sprint-kickoff.mp3",
    fileSize: 8_912_345,
    duration: 1023.2,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "recordings/user-001/rec-002/design-sprint-kickoff.mp3",
    tags: ["design", "sprint"],
    status: "transcribing",
    createdAt: NOW - 3 * DAY,
    updatedAt: NOW - 3 * DAY,
  },
  {
    id: "rec-003",
    userId: "user-001",
    title: "Customer Interview - Acme Corp",
    description: "Discovery call with Acme Corp engineering lead about their workflow.",
    fileName: "acme-interview.mp3",
    fileSize: 22_456_789,
    duration: 2756.8,
    format: "mp3",
    sampleRate: 48000,
    ossKey: "recordings/user-001/rec-003/acme-interview.mp3",
    tags: ["interview", "customer", "acme"],
    status: "uploaded",
    createdAt: NOW - 1 * DAY,
    updatedAt: NOW - 1 * DAY,
  },
  {
    id: "rec-004",
    userId: "user-001",
    title: "Team Standup - Feb 18",
    description: null,
    fileName: "standup-feb18.mp3",
    fileSize: 3_456_789,
    duration: 412.0,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "recordings/user-001/rec-004/standup-feb18.mp3",
    tags: ["standup"],
    status: "completed",
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - 2 * DAY,
  },
  {
    id: "rec-005",
    userId: "user-001",
    title: "Podcast Episode Draft",
    description: "Raw recording for episode 12 on developer productivity.",
    fileName: "podcast-ep12-raw.mp3",
    fileSize: 45_678_901,
    duration: 5234.6,
    format: "mp3",
    sampleRate: 48000,
    ossKey: "recordings/user-001/rec-005/podcast-ep12-raw.mp3",
    tags: ["podcast", "draft"],
    status: "failed",
    createdAt: NOW - 5 * DAY,
    updatedAt: NOW - 5 * DAY,
  },
];

// ── Mock transcription job ──

export const MOCK_JOB: TranscriptionJob = {
  id: "job-001",
  recordingId: "rec-001",
  taskId: "dashscope-task-abc123",
  requestId: "req-xyz789",
  status: "SUCCEEDED",
  submitTime: "2025-02-12 10:00:00.000",
  endTime: "2025-02-12 10:02:35.000",
  usageSeconds: 1848,
  errorMessage: null,
  resultUrl: "https://dashscope-result.oss.aliyuncs.com/result.json",
  createdAt: NOW - 7 * DAY,
  updatedAt: NOW - 7 * DAY,
};

// ── Mock transcription ──

export const MOCK_TRANSCRIPTION: Transcription = {
  id: "tx-001",
  recordingId: "rec-001",
  jobId: "job-001",
  fullText: mockFullText,
  sentences: mockSentences,
  language: "en",
  createdAt: NOW - 7 * DAY,
  updatedAt: NOW - 7 * DAY,
};

// ── Mock recording details ──

export const MOCK_RECORDING_DETAILS: RecordingDetail[] = MOCK_RECORDINGS.map(
  (rec) => ({
    ...rec,
    transcription: rec.id === "rec-001" || rec.id === "rec-004"
      ? { ...MOCK_TRANSCRIPTION, id: `tx-${rec.id}`, recordingId: rec.id }
      : null,
    latestJob: rec.id === "rec-001" || rec.id === "rec-004"
      ? { ...MOCK_JOB, id: `job-${rec.id}`, recordingId: rec.id }
      : rec.id === "rec-002"
        ? {
            ...MOCK_JOB,
            id: "job-002",
            recordingId: "rec-002",
            status: "RUNNING" as const,
            endTime: null,
            resultUrl: null,
            usageSeconds: null,
          }
        : rec.id === "rec-005"
          ? {
              ...MOCK_JOB,
              id: "job-005",
              recordingId: "rec-005",
              status: "FAILED" as const,
              errorMessage: "Audio format not supported or file corrupted.",
              resultUrl: null,
              usageSeconds: null,
            }
          : null,
  }),
);
