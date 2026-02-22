/**
 * Dashboard View Model
 *
 * Pure functions that transform raw API data into chart-ready shapes.
 * No React hooks — consumed by the dashboard page components.
 */

import { formatFileSize, formatDuration } from "./recordings-list-vm";
import type { RecordingStatus } from "./types";

// ── API response types ──

export interface MonthlyCount {
  month: string;
  count: number;
}

export interface MonthlyDuration {
  month: string;
  duration: number;
}

export interface StatusBreakdown {
  status: RecordingStatus;
  count: number;
}

export interface FormatBreakdown {
  format: string;
  count: number;
  totalSize: number;
}

export interface RecordingStats {
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

export interface OssBucketStats {
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
  total: {
    files: number;
    size: number;
    orphanFiles: number;
    orphanSize: number;
  };
  sizeByMonth: { month: string; uploads: number; results: number }[];
}

export interface DashboardData {
  recordings: RecordingStats;
  oss: OssBucketStats;
}

// ── View model types ──

export interface StatCardVM {
  label: string;
  value: string;
  subtitle?: string;
}

// ── Transform functions ──

/** Short month label from YYYY-MM key, e.g. "2025-06" → "Jun" */
export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!y || !m) return yearMonth;
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString("en-US", { month: "short" });
}

/** Full month label, e.g. "2025-06" → "Jun 2025" */
export function monthLabelFull(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!y || !m) return yearMonth;
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Format total duration into a readable string, e.g. "12h 34m" */
export function formatTotalDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Build recording stat cards */
export function buildRecordingStatCards(stats: RecordingStats): StatCardVM[] {
  const completionRate =
    stats.totalCount > 0
      ? Math.round((stats.completedCount / stats.totalCount) * 100)
      : 0;

  return [
    {
      label: "Total Recordings",
      value: String(stats.totalCount),
    },
    {
      label: "Total Duration",
      value: formatTotalDuration(stats.totalDuration),
      subtitle: `avg ${formatDuration(stats.avgDuration)}`,
    },
    {
      label: "Total Size",
      value: formatFileSize(stats.totalSize),
      subtitle: `avg ${formatFileSize(stats.avgSize)}`,
    },
    {
      label: "Completion Rate",
      value: `${completionRate}%`,
      subtitle: `${stats.completedCount} of ${stats.totalCount}`,
    },
  ];
}

/** Build OSS stat cards */
export function buildOssStatCards(stats: OssBucketStats): StatCardVM[] {
  return [
    {
      label: "Total Files",
      value: String(stats.total.files),
      subtitle: `${stats.uploads.totalFiles} uploads · ${stats.results.totalFiles} results`,
    },
    {
      label: "Total Storage",
      value: formatFileSize(stats.total.size),
      subtitle: `${formatFileSize(stats.uploads.totalSize)} uploads · ${formatFileSize(stats.results.totalSize)} results`,
    },
    {
      label: "Orphan Files",
      value: String(stats.total.orphanFiles),
      subtitle: stats.total.orphanFiles > 0
        ? `${formatFileSize(stats.total.orphanSize)} reclaimable`
        : "all clean",
    },
  ];
}

/** Status label for display */
export function statusLabel(status: RecordingStatus): string {
  const map: Record<RecordingStatus, string> = {
    uploaded: "Uploaded",
    transcribing: "Transcribing",
    completed: "Completed",
    failed: "Failed",
  };
  return map[status];
}

/** Status color index (maps to chart palette) */
export function statusColorIndex(status: RecordingStatus): number {
  const map: Record<RecordingStatus, number> = {
    completed: 4, // chart-5 (green)
    uploaded: 1, // chart-2 (sky)
    transcribing: 6, // chart-7 (amber)
    failed: 9, // chart-10 (red)
  };
  return map[status];
}
