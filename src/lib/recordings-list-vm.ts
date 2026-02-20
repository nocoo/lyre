/**
 * Recordings List View Model
 *
 * Pure functions that transform Recording[] data into view-ready shapes.
 * No React hooks — consumed by the recordings list page.
 */

import type { Recording, RecordingStatus, PaginatedResponse } from "./types";

// ── Formatting helpers ──

/** Format bytes into human-readable string (KB, MB, GB) */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format duration in seconds to HH:MM:SS or MM:SS */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format Unix timestamp (ms) to relative time (e.g. "3 days ago") */
export function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diff = now - timestampMs;

  if (diff < 0) return "just now";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/** Format Unix timestamp (ms) to date string */
export function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Status helpers ──

export interface StatusInfo {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
}

const STATUS_MAP: Record<RecordingStatus, StatusInfo> = {
  uploaded: { label: "Uploaded", variant: "secondary" },
  transcribing: { label: "Transcribing", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

export function getStatusInfo(status: RecordingStatus): StatusInfo {
  return STATUS_MAP[status];
}

// ── Recording card view model ──

export interface RecordingCardVM {
  id: string;
  title: string;
  description: string;
  duration: string;
  fileSize: string;
  status: StatusInfo;
  tags: string[];
  createdAt: string;
  createdAtRelative: string;
}

export function toRecordingCardVM(recording: Recording): RecordingCardVM {
  return {
    id: recording.id,
    title: recording.title,
    description: recording.description ?? "",
    duration: formatDuration(recording.duration),
    fileSize: formatFileSize(recording.fileSize),
    status: getStatusInfo(recording.status),
    tags: recording.tags,
    createdAt: formatDate(recording.createdAt),
    createdAtRelative: formatRelativeTime(recording.createdAt),
  };
}

// ── List view model ──

export interface RecordingsListVM {
  cards: RecordingCardVM[];
  total: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isEmpty: boolean;
}

export function toRecordingsListVM(
  response: PaginatedResponse<Recording>,
): RecordingsListVM {
  return {
    cards: response.items.map(toRecordingCardVM),
    total: response.total,
    page: response.page,
    totalPages: response.totalPages,
    hasNextPage: response.page < response.totalPages,
    hasPreviousPage: response.page > 1,
    isEmpty: response.items.length === 0,
  };
}

// ── Filtering & sorting (client-side, for mock phase) ──

export type SortField = "title" | "createdAt" | "duration" | "fileSize";
export type SortDirection = "asc" | "desc";

export function filterRecordings(
  recordings: Recording[],
  query: string,
  statusFilter: RecordingStatus | "all",
): Recording[] {
  let result = recordings;

  if (statusFilter !== "all") {
    result = result.filter((r) => r.status === statusFilter);
  }

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    result = result.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  return result;
}

export function sortRecordings(
  recordings: Recording[],
  field: SortField,
  direction: SortDirection,
): Recording[] {
  const sorted = [...recordings];
  const dir = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "createdAt":
        return dir * (a.createdAt - b.createdAt);
      case "duration":
        return dir * ((a.duration ?? 0) - (b.duration ?? 0));
      case "fileSize":
        return dir * ((a.fileSize ?? 0) - (b.fileSize ?? 0));
    }
  });

  return sorted;
}

/** Build a paginated response from a full array */
export function paginateRecordings(
  recordings: Recording[],
  page: number,
  pageSize: number,
): PaginatedResponse<Recording> {
  const total = recordings.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;
  const items = recordings.slice(start, start + pageSize);

  return { items, total, page: safePage, pageSize, totalPages };
}
