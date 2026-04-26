/**
 * Dashboard stats API.
 *
 * GET /api/dashboard — Aggregate recording + OSS stats for the current user.
 *
 * Recording stats are computed from the local SQLite database (fast).
 * OSS stats require a network call to list all objects (slower), so they are
 * returned in a separate section. The client can choose to load them lazily.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo, jobsRepo } from "@/db/repositories";
import { listObjects } from "@/services/oss";
import type { RecordingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// ── Types ──

interface MonthlyCount {
  /** YYYY-MM */
  month: string;
  count: number;
}

interface MonthlyDuration {
  /** YYYY-MM */
  month: string;
  /** Total seconds */
  duration: number;
}

interface StatusBreakdown {
  status: RecordingStatus;
  count: number;
}

interface FormatBreakdown {
  format: string;
  count: number;
  totalSize: number;
}

interface RecordingStats {
  totalCount: number;
  totalDuration: number; // seconds
  totalSize: number; // bytes
  completedCount: number;
  failedCount: number;
  transcribingCount: number;
  uploadedCount: number;
  avgDuration: number; // seconds
  avgSize: number; // bytes
  byMonth: MonthlyCount[];
  durationByMonth: MonthlyDuration[];
  byStatus: StatusBreakdown[];
  byFormat: FormatBreakdown[];
}

interface OssBucketStats {
  uploads: {
    totalFiles: number;
    totalSize: number;
    /** Folders with no matching DB recording */
    orphanFiles: number;
    orphanSize: number;
  };
  results: {
    totalFiles: number;
    totalSize: number;
    orphanFiles: number;
    orphanSize: number;
  };
  total: {
    files: number;
    size: number;
    orphanFiles: number;
    orphanSize: number;
  };
  /** Storage by month (based on lastModified) */
  sizeByMonth: { month: string; uploads: number; results: number }[];
}

interface DashboardResponse {
  recordings: RecordingStats;
  oss: OssBucketStats;
}

// ── Helpers ──

function toMonthKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toMonthKeyFromIso(iso: string): string {
  // lastModified from OSS is ISO 8601, e.g. "2025-06-15T10:30:00.000Z"
  return iso.slice(0, 7);
}

/** Generate an array of YYYY-MM keys covering the last N months (inclusive). */
function lastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(toMonthKey(d.getTime()));
  }
  return months;
}

// ── Handler ──

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Recording stats (from DB — fast) ──
  const allRecordings = recordingsRepo.findAll(user.id);

  const statusCounts: Record<RecordingStatus, number> = {
    uploaded: 0,
    transcribing: 0,
    completed: 0,
    failed: 0,
  };

  const monthlyCountMap = new Map<string, number>();
  const monthlyDurationMap = new Map<string, number>();
  const formatMap = new Map<string, { count: number; totalSize: number }>();

  let totalDuration = 0;
  let totalSize = 0;

  for (const rec of allRecordings) {
    // Status
    statusCounts[rec.status as RecordingStatus]++;

    // Duration & size
    totalDuration += rec.duration ?? 0;
    totalSize += rec.fileSize ?? 0;

    // Monthly counts
    const monthKey = toMonthKey(rec.createdAt);
    monthlyCountMap.set(monthKey, (monthlyCountMap.get(monthKey) ?? 0) + 1);

    // Monthly duration
    monthlyDurationMap.set(
      monthKey,
      (monthlyDurationMap.get(monthKey) ?? 0) + (rec.duration ?? 0),
    );

    // Format breakdown
    const fmt = rec.format ?? "unknown";
    const existing = formatMap.get(fmt) ?? { count: 0, totalSize: 0 };
    existing.count++;
    existing.totalSize += rec.fileSize ?? 0;
    formatMap.set(fmt, existing);
  }

  // Fill in last 12 months for consistent chart rendering
  const months = lastNMonths(12);
  const byMonth: MonthlyCount[] = months.map((month) => ({
    month,
    count: monthlyCountMap.get(month) ?? 0,
  }));
  const durationByMonth: MonthlyDuration[] = months.map((month) => ({
    month,
    duration: Math.round(monthlyDurationMap.get(month) ?? 0),
  }));

  const totalCount = allRecordings.length;

  const recordingStats: RecordingStats = {
    totalCount,
    totalDuration: Math.round(totalDuration),
    totalSize,
    completedCount: statusCounts.completed,
    failedCount: statusCounts.failed,
    transcribingCount: statusCounts.transcribing,
    uploadedCount: statusCounts.uploaded,
    avgDuration: totalCount > 0 ? Math.round(totalDuration / totalCount) : 0,
    avgSize: totalCount > 0 ? Math.round(totalSize / totalCount) : 0,
    byMonth,
    durationByMonth,
    byStatus: (
      ["uploaded", "transcribing", "completed", "failed"] as RecordingStatus[]
    ).map((status) => ({
      status,
      count: statusCounts[status],
    })),
    byFormat: Array.from(formatMap.entries())
      .map(([format, data]) => ({ format, ...data }))
      .sort((a, b) => b.count - a.count),
  };

  // ── OSS stats (network call — slower) ──
  const [uploadObjects, resultObjects] = await Promise.all([
    listObjects(`uploads/${user.id}/`),
    listObjects("results/"),
  ]);

  // Build set of known recording IDs for orphan detection
  const recordingIdSet = new Set(allRecordings.map((r) => r.id));

  // Build set of known job IDs for this user's recordings
  const userJobIdSet = new Set<string>();
  for (const rec of allRecordings) {
    const jobs = jobsRepo.findByRecordingId(rec.id);
    for (const job of jobs) {
      userJobIdSet.add(job.id);
    }
  }

  // Uploads: uploads/{userId}/{recordingId}/{file}
  let uploadTotalFiles = 0;
  let uploadTotalSize = 0;
  let uploadOrphanFiles = 0;
  let uploadOrphanSize = 0;

  const ossSizeByMonthMap = new Map<
    string,
    { uploads: number; results: number }
  >();

  for (const obj of uploadObjects) {
    uploadTotalFiles++;
    uploadTotalSize += obj.size;

    const parts = obj.key.split("/");
    const recordingId = parts[2]; // uploads/{userId}/{recordingId}/{file}
    if (recordingId && !recordingIdSet.has(recordingId)) {
      uploadOrphanFiles++;
      uploadOrphanSize += obj.size;
    }

    const mk = toMonthKeyFromIso(obj.lastModified);
    const entry = ossSizeByMonthMap.get(mk) ?? { uploads: 0, results: 0 };
    entry.uploads += obj.size;
    ossSizeByMonthMap.set(mk, entry);
  }

  // Results: results/{jobId}/{file} — only count results belonging to this user
  let resultTotalFiles = 0;
  let resultTotalSize = 0;
  let resultOrphanFiles = 0;
  let resultOrphanSize = 0;

  for (const obj of resultObjects) {
    const parts = obj.key.split("/");
    const jobId = parts[1];
    if (!jobId) continue;

    // Only include results that belong to this user's jobs
    if (!userJobIdSet.has(jobId)) continue;

    resultTotalFiles++;
    resultTotalSize += obj.size;

    const job = jobsRepo.findById(jobId);
    if (!job) {
      resultOrphanFiles++;
      resultOrphanSize += obj.size;
    }

    const mk = toMonthKeyFromIso(obj.lastModified);
    const entry = ossSizeByMonthMap.get(mk) ?? { uploads: 0, results: 0 };
    entry.results += obj.size;
    ossSizeByMonthMap.set(mk, entry);
  }

  // Fill monthly OSS data for last 12 months
  const sizeByMonth = months.map((month) => {
    const entry = ossSizeByMonthMap.get(month) ?? { uploads: 0, results: 0 };
    return { month, ...entry };
  });

  const ossStats: OssBucketStats = {
    uploads: {
      totalFiles: uploadTotalFiles,
      totalSize: uploadTotalSize,
      orphanFiles: uploadOrphanFiles,
      orphanSize: uploadOrphanSize,
    },
    results: {
      totalFiles: resultTotalFiles,
      totalSize: resultTotalSize,
      orphanFiles: resultOrphanFiles,
      orphanSize: resultOrphanSize,
    },
    total: {
      files: uploadTotalFiles + resultTotalFiles,
      size: uploadTotalSize + resultTotalSize,
      orphanFiles: uploadOrphanFiles + resultOrphanFiles,
      orphanSize: uploadOrphanSize + resultOrphanSize,
    },
    sizeByMonth,
  };

  const response: DashboardResponse = {
    recordings: recordingStats,
    oss: ossStats,
  };

  return NextResponse.json(response);
}
