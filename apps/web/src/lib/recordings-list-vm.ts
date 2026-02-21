/**
 * Recordings List View Model
 *
 * Pure functions that transform Recording[] / RecordingListItem[] data into view-ready shapes.
 * No React hooks — consumed by the recordings list page and global search.
 */

import type {
  Recording,
  RecordingListItem,
  RecordingStatus,
  PaginatedResponse,
  Tag,
  Folder,
} from "./types";

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

/** Format audio format string to uppercase display label */
export function formatAudioFormat(format: string | null): string {
  if (!format) return "—";
  return format.toUpperCase();
}

/** Format sample rate to human-readable (e.g. "48 kHz") */
export function formatSampleRate(rate: number | null): string {
  if (rate === null || rate <= 0) return "—";
  if (rate >= 1000) return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`;
  return `${rate} Hz`;
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

// ── Tag color helpers ──

/**
 * Stable color palette for tags.
 * Each tag name is hashed to a consistent color from this palette.
 */
const TAG_COLORS = [
  { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300" },
  { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-pink-100 dark:bg-pink-900/40", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/40", text: "text-cyan-700 dark:text-cyan-300" },
  { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300" },
] as const;

export interface TagVM {
  id: string;
  name: string;
  bgClass: string;
  textClass: string;
}

/** Hash a string to a stable index */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Convert a tag to a colorized view model */
export function toTagVM(tag: Tag): TagVM {
  const colorIndex = hashString(tag.name) % TAG_COLORS.length;
  const color = TAG_COLORS[colorIndex]!;
  return {
    id: tag.id,
    name: tag.name,
    bgClass: color.bg,
    textClass: color.text,
  };
}

/** Convert legacy tag names to colorized view models (without resolved Tag objects) */
export function toTagVMFromName(name: string, index: number): TagVM {
  const colorIndex = hashString(name) % TAG_COLORS.length;
  const color = TAG_COLORS[colorIndex]!;
  return {
    id: `legacy-${index}`,
    name,
    bgClass: color.bg,
    textClass: color.text,
  };
}

// ── Folder info ──

export interface FolderInfo {
  id: string;
  name: string;
  icon: string;
}

export function toFolderInfo(folder: Folder | null): FolderInfo | null {
  if (!folder) return null;
  return {
    id: folder.id,
    name: folder.name,
    icon: folder.icon,
  };
}

// ── Recording card view model (enriched) ──

export interface RecordingCardVM {
  id: string;
  title: string;
  description: string;
  duration: string;
  durationRaw: number | null;
  fileSize: string;
  fileSizeRaw: number | null;
  format: string;
  sampleRate: string;
  status: StatusInfo;
  statusRaw: RecordingStatus;
  tags: string[]; // legacy tag names
  colorTags: TagVM[]; // colorized resolved tags (preferred) or legacy fallback
  folder: FolderInfo | null;
  aiSummary: string; // truncated for card display
  createdAt: string;
  createdAtRelative: string;
  recordedAt: string;
}

/** Convert a Recording (basic) to card VM — backward compatible */
export function toRecordingCardVM(recording: Recording): RecordingCardVM {
  return toRecordingListItemCardVM({
    ...recording,
    folder: null,
    resolvedTags: [],
  });
}

/** Convert a RecordingListItem (enriched) to card VM */
export function toRecordingListItemCardVM(item: RecordingListItem): RecordingCardVM {
  // Prefer resolved tags over legacy tag names
  const colorTags = item.resolvedTags.length > 0
    ? item.resolvedTags.map(toTagVM)
    : item.tags.map(toTagVMFromName);

  return {
    id: item.id,
    title: item.title,
    description: item.description ?? "",
    duration: formatDuration(item.duration),
    durationRaw: item.duration,
    fileSize: formatFileSize(item.fileSize),
    fileSizeRaw: item.fileSize,
    format: formatAudioFormat(item.format),
    sampleRate: formatSampleRate(item.sampleRate),
    status: getStatusInfo(item.status),
    statusRaw: item.status,
    tags: item.tags,
    colorTags,
    folder: toFolderInfo(item.folder),
    aiSummary: item.aiSummary ?? "",
    createdAt: formatDate(item.createdAt),
    createdAtRelative: formatRelativeTime(item.createdAt),
    recordedAt: item.recordedAt ? formatDate(item.recordedAt) : "",
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
  response: PaginatedResponse<RecordingListItem>,
): RecordingsListVM {
  return {
    cards: response.items.map(toRecordingListItemCardVM),
    total: response.total,
    page: response.page,
    totalPages: response.totalPages,
    hasNextPage: response.page < response.totalPages,
    hasPreviousPage: response.page > 1,
    isEmpty: response.items.length === 0,
  };
}

/** Legacy overload: convert PaginatedResponse<Recording> (without enrichment) */
export function toBasicRecordingsListVM(
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
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        (r.aiSummary?.toLowerCase().includes(q) ?? false),
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

// ── Bulk filter (for batch management) ──

/** Criteria for bulk-filtering recordings. All conditions use OR logic. */
export interface BulkFilterCriteria {
  /** Select recordings created before this timestamp (ms) */
  createdBefore?: number;
  /** Select recordings shorter than this duration (seconds) */
  durationBelow?: number;
  /** Select recordings longer than this duration (seconds) */
  durationAbove?: number;
  /** Select recordings larger than this file size (bytes) */
  fileSizeAbove?: number;
}

/** Minimal card shape needed for bulk filtering */
interface BulkFilterableCard {
  id: string;
  createdAtMs: number;
  durationRaw: number | null;
  fileSizeRaw: number | null;
}

/**
 * Apply bulk filter criteria to a list of recordings.
 * Conditions are combined with OR logic: a recording matches if ANY criterion is met.
 * Returns an array of matching recording IDs (deduplicated).
 */
export function bulkFilterRecordings(
  cards: BulkFilterableCard[],
  criteria: BulkFilterCriteria,
): string[] {
  const hasCriteria =
    criteria.createdBefore !== undefined ||
    criteria.durationBelow !== undefined ||
    criteria.durationAbove !== undefined ||
    criteria.fileSizeAbove !== undefined;

  if (!hasCriteria) return [];

  const matchedIds = new Set<string>();

  for (const card of cards) {
    if (
      criteria.createdBefore !== undefined &&
      card.createdAtMs < criteria.createdBefore
    ) {
      matchedIds.add(card.id);
      continue;
    }
    if (
      criteria.durationBelow !== undefined &&
      card.durationRaw !== null &&
      card.durationRaw < criteria.durationBelow
    ) {
      matchedIds.add(card.id);
      continue;
    }
    if (
      criteria.durationAbove !== undefined &&
      card.durationRaw !== null &&
      card.durationRaw > criteria.durationAbove
    ) {
      matchedIds.add(card.id);
      continue;
    }
    if (
      criteria.fileSizeAbove !== undefined &&
      card.fileSizeRaw !== null &&
      card.fileSizeRaw > criteria.fileSizeAbove
    ) {
      matchedIds.add(card.id);
    }
  }

  return Array.from(matchedIds);
}

/** Preset filter definitions for common bulk-management scenarios */
export interface BulkFilterPreset {
  id: string;
  label: string;
  description: string;
  criteria: BulkFilterCriteria;
}

const DAY_MS = 86_400_000;

export const BULK_FILTER_PRESETS: BulkFilterPreset[] = [
  {
    id: "old",
    label: "Old recordings",
    description: "Created more than 90 days ago",
    criteria: { createdBefore: Date.now() - 90 * DAY_MS },
  },
  {
    id: "short",
    label: "Very short",
    description: "Less than 30 seconds",
    criteria: { durationBelow: 30 },
  },
  {
    id: "long",
    label: "Very long",
    description: "Longer than 2 hours",
    criteria: { durationAbove: 7200 },
  },
  {
    id: "large",
    label: "Large files",
    description: "Larger than 100 MB",
    criteria: { fileSizeAbove: 100 * 1024 * 1024 },
  },
];
