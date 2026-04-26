/**
 * Handler for `/api/dashboard` — aggregate recording + OSS stats for current user.
 *
 * Recording stats are computed from SQLite (fast). OSS stats require listing
 * all objects (slower). Both are returned in a single response.
 */

import { makeRepos } from "../db/repositories";
import { listObjects } from "../services/oss";
import type { RecordingStatus } from "../lib/types";
import type { RuntimeContext } from "../runtime/context";
import { json, unauthorized, type HandlerResponse } from "./http";

interface MonthlyCount {
  month: string;
  count: number;
}
interface MonthlyDuration {
  month: string;
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
  totalDuration: number;
  totalSize: number;
  completedCount: number;
  failedCount: number;
  transcribingCount: number;
  uploadedCount: number;
  avgDuration: number;
  avgSize: number;
  byMonth: MonthlyCount[];
  durationByMonth: MonthlyDuration[];
  byStatus: StatusBreakdown[];
  byFormat: FormatBreakdown[];
}

interface OssBucketStats {
  uploads: {
    totalFiles: number;
    totalSize: number;
    orphanFiles: number;
    orphanSize: number;
  };
  results: {
    totalFiles: number;
    totalSize: number;
    orphanFiles: number;
    orphanSize: number;
  };
  total: { files: number; size: number; orphanFiles: number; orphanSize: number };
  sizeByMonth: { month: string; uploads: number; results: number }[];
}

interface DashboardResponse {
  recordings: RecordingStats;
  oss: OssBucketStats;
}

function toMonthKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function toMonthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}
function lastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(toMonthKey(d.getTime()));
  }
  return months;
}

export async function dashboardHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const userId = ctx.user.id;
  const { recordings, jobs } = makeRepos(ctx.db);
  const allRecordings = await recordings.findAll(userId);

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
    statusCounts[rec.status as RecordingStatus]++;
    totalDuration += rec.duration ?? 0;
    totalSize += rec.fileSize ?? 0;
    const monthKey = toMonthKey(rec.createdAt);
    monthlyCountMap.set(monthKey, (monthlyCountMap.get(monthKey) ?? 0) + 1);
    monthlyDurationMap.set(
      monthKey,
      (monthlyDurationMap.get(monthKey) ?? 0) + (rec.duration ?? 0),
    );
    const fmt = rec.format ?? "unknown";
    const existing = formatMap.get(fmt) ?? { count: 0, totalSize: 0 };
    existing.count++;
    existing.totalSize += rec.fileSize ?? 0;
    formatMap.set(fmt, existing);
  }

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
    ).map((status) => ({ status, count: statusCounts[status] })),
    byFormat: Array.from(formatMap.entries())
      .map(([format, data]) => ({ format, ...data }))
      .sort((a, b) => b.count - a.count),
  };

  const [uploadObjects, resultObjects] = await Promise.all([
    listObjects(`uploads/${userId}/`, undefined, ctx.env),
    listObjects("results/", undefined, ctx.env),
  ]);

  const recordingIdSet = new Set(allRecordings.map((r) => r.id));
  const userJobIdSet = new Set<string>();
  for (const rec of allRecordings) {
    for (const job of await jobs.findByRecordingId(rec.id)) {
      userJobIdSet.add(job.id);
    }
  }

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
    const recordingId = parts[2];
    if (recordingId && !recordingIdSet.has(recordingId)) {
      uploadOrphanFiles++;
      uploadOrphanSize += obj.size;
    }
    const mk = toMonthKeyFromIso(obj.lastModified);
    const entry = ossSizeByMonthMap.get(mk) ?? { uploads: 0, results: 0 };
    entry.uploads += obj.size;
    ossSizeByMonthMap.set(mk, entry);
  }

  let resultTotalFiles = 0;
  let resultTotalSize = 0;
  let resultOrphanFiles = 0;
  let resultOrphanSize = 0;
  for (const obj of resultObjects) {
    const parts = obj.key.split("/");
    const jobId = parts[1];
    if (!jobId) continue;
    if (!userJobIdSet.has(jobId)) continue;
    resultTotalFiles++;
    resultTotalSize += obj.size;
    const job = await jobs.findById(jobId);
    if (!job) {
      resultOrphanFiles++;
      resultOrphanSize += obj.size;
    }
    const mk = toMonthKeyFromIso(obj.lastModified);
    const entry = ossSizeByMonthMap.get(mk) ?? { uploads: 0, results: 0 };
    entry.results += obj.size;
    ossSizeByMonthMap.set(mk, entry);
  }

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
  return json(response);
}
