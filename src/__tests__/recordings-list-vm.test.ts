import { describe, expect, test } from "bun:test";
import {
  formatFileSize,
  formatDuration,
  formatRelativeTime,
  formatDate,
  getStatusInfo,
  toRecordingCardVM,
  toRecordingsListVM,
  filterRecordings,
  sortRecordings,
  paginateRecordings,
} from "@/lib/recordings-list-vm";
import { MOCK_RECORDINGS } from "@/lib/mock-data";
import type { Recording, PaginatedResponse } from "@/lib/types";

// ── formatFileSize ──

describe("formatFileSize", () => {
  test("returns dash for null", () => {
    expect(formatFileSize(null)).toBe("—");
  });

  test("returns dash for 0", () => {
    expect(formatFileSize(0)).toBe("—");
  });

  test("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  test("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  test("formats megabytes", () => {
    expect(formatFileSize(15_728_640)).toBe("15.0 MB");
  });

  test("formats gigabytes", () => {
    expect(formatFileSize(2_147_483_648)).toBe("2.00 GB");
  });
});

// ── formatDuration ──

describe("formatDuration", () => {
  test("returns dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });

  test("returns dash for 0", () => {
    expect(formatDuration(0)).toBe("—");
  });

  test("returns dash for negative", () => {
    expect(formatDuration(-5)).toBe("—");
  });

  test("formats seconds only", () => {
    expect(formatDuration(45)).toBe("0:45");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  test("formats hours", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  test("formats with zero padding", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
  });
});

// ── formatRelativeTime ──

describe("formatRelativeTime", () => {
  test("returns 'just now' for future timestamps", () => {
    expect(formatRelativeTime(Date.now() + 10000)).toBe("just now");
  });

  test("returns 'just now' for very recent", () => {
    expect(formatRelativeTime(Date.now() - 5000)).toBe("just now");
  });

  test("returns minutes ago", () => {
    expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe("5m ago");
  });

  test("returns hours ago", () => {
    expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe(
      "3h ago",
    );
  });

  test("returns days ago", () => {
    expect(formatRelativeTime(Date.now() - 7 * 24 * 60 * 60 * 1000)).toBe(
      "7d ago",
    );
  });

  test("returns months ago", () => {
    expect(formatRelativeTime(Date.now() - 90 * 24 * 60 * 60 * 1000)).toBe(
      "3mo ago",
    );
  });

  test("returns years ago", () => {
    expect(formatRelativeTime(Date.now() - 400 * 24 * 60 * 60 * 1000)).toBe(
      "1y ago",
    );
  });
});

// ── formatDate ──

describe("formatDate", () => {
  test("formats a timestamp", () => {
    // 2025-01-15T00:00:00.000Z
    const ts = new Date("2025-01-15T00:00:00.000Z").getTime();
    const result = formatDate(ts);
    expect(result).toContain("Jan");
    expect(result).toContain("2025");
    expect(result).toContain("15");
  });
});

// ── getStatusInfo ──

describe("getStatusInfo", () => {
  test("returns correct info for uploaded", () => {
    const info = getStatusInfo("uploaded");
    expect(info.label).toBe("Uploaded");
    expect(info.variant).toBe("secondary");
  });

  test("returns correct info for transcribing", () => {
    const info = getStatusInfo("transcribing");
    expect(info.label).toBe("Transcribing");
    expect(info.variant).toBe("outline");
  });

  test("returns correct info for completed", () => {
    const info = getStatusInfo("completed");
    expect(info.label).toBe("Completed");
    expect(info.variant).toBe("default");
  });

  test("returns correct info for failed", () => {
    const info = getStatusInfo("failed");
    expect(info.label).toBe("Failed");
    expect(info.variant).toBe("destructive");
  });
});

// ── toRecordingCardVM ──

describe("toRecordingCardVM", () => {
  const rec = MOCK_RECORDINGS[0]!;

  test("maps id and title", () => {
    const vm = toRecordingCardVM(rec);
    expect(vm.id).toBe(rec.id);
    expect(vm.title).toBe(rec.title);
  });

  test("maps description with fallback", () => {
    const vm = toRecordingCardVM(rec);
    expect(vm.description).toBe(rec.description!);

    const noDesc = { ...rec, description: null };
    expect(toRecordingCardVM(noDesc).description).toBe("");
  });

  test("formats duration", () => {
    const vm = toRecordingCardVM(rec);
    expect(vm.duration).toBe("30:47"); // 1847.5s
  });

  test("formats file size", () => {
    const vm = toRecordingCardVM(rec);
    expect(vm.fileSize).toBe("15.0 MB");
  });

  test("maps status info", () => {
    const vm = toRecordingCardVM(rec);
    expect(vm.status.label).toBe("Completed");
  });

  test("maps tags", () => {
    const vm = toRecordingCardVM(rec);
    expect(vm.tags).toEqual(["meeting", "product", "quarterly"]);
  });
});

// ── toRecordingsListVM ──

describe("toRecordingsListVM", () => {
  const response: PaginatedResponse<Recording> = {
    items: MOCK_RECORDINGS.slice(0, 2),
    total: 5,
    page: 1,
    pageSize: 2,
    totalPages: 3,
  };

  test("maps cards", () => {
    const vm = toRecordingsListVM(response);
    expect(vm.cards).toHaveLength(2);
    expect(vm.cards[0]!.title).toBe(MOCK_RECORDINGS[0]!.title);
  });

  test("maps pagination info", () => {
    const vm = toRecordingsListVM(response);
    expect(vm.total).toBe(5);
    expect(vm.page).toBe(1);
    expect(vm.totalPages).toBe(3);
    expect(vm.hasNextPage).toBe(true);
    expect(vm.hasPreviousPage).toBe(false);
  });

  test("isEmpty is false for non-empty", () => {
    const vm = toRecordingsListVM(response);
    expect(vm.isEmpty).toBe(false);
  });

  test("isEmpty is true for empty", () => {
    const vm = toRecordingsListVM({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    expect(vm.isEmpty).toBe(true);
  });
});

// ── filterRecordings ──

describe("filterRecordings", () => {
  test("returns all when no filter", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "", "all");
    expect(result).toHaveLength(5);
  });

  test("filters by status", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "", "completed");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.status === "completed")).toBe(true);
  });

  test("filters by title query", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "podcast", "all");
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toContain("Podcast");
  });

  test("filters by tag query", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "meeting", "all");
    expect(result).toHaveLength(1);
  });

  test("filters by description query", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "brainstorming", "all");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("rec-002");
  });

  test("combines status and query", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "standup", "completed");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("rec-004");
  });

  test("returns empty for no match", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "nonexistent", "all");
    expect(result).toHaveLength(0);
  });

  test("case insensitive search", () => {
    const result = filterRecordings(MOCK_RECORDINGS, "PODCAST", "all");
    expect(result).toHaveLength(1);
  });
});

// ── sortRecordings ──

describe("sortRecordings", () => {
  test("sorts by title ascending", () => {
    const sorted = sortRecordings(MOCK_RECORDINGS, "title", "asc");
    expect(sorted[0]!.title).toBe("Customer Interview - Acme Corp");
  });

  test("sorts by title descending", () => {
    const sorted = sortRecordings(MOCK_RECORDINGS, "title", "desc");
    expect(sorted[0]!.title).toBe("Team Standup - Feb 18");
  });

  test("sorts by createdAt ascending", () => {
    const sorted = sortRecordings(MOCK_RECORDINGS, "createdAt", "asc");
    expect(sorted[0]!.id).toBe("rec-001"); // oldest
  });

  test("sorts by createdAt descending", () => {
    const sorted = sortRecordings(MOCK_RECORDINGS, "createdAt", "desc");
    expect(sorted[0]!.id).toBe("rec-003"); // newest
  });

  test("sorts by duration ascending", () => {
    const sorted = sortRecordings(MOCK_RECORDINGS, "duration", "asc");
    expect(sorted[0]!.id).toBe("rec-004"); // shortest: 412s
  });

  test("does not mutate original array", () => {
    const original = [...MOCK_RECORDINGS];
    sortRecordings(MOCK_RECORDINGS, "title", "asc");
    expect(MOCK_RECORDINGS.map((r) => r.id)).toEqual(
      original.map((r) => r.id),
    );
  });
});

// ── paginateRecordings ──

describe("paginateRecordings", () => {
  test("returns first page", () => {
    const result = paginateRecordings(MOCK_RECORDINGS, 1, 2);
    expect(result.items).toHaveLength(2);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.total).toBe(5);
  });

  test("returns second page", () => {
    const result = paginateRecordings(MOCK_RECORDINGS, 2, 2);
    expect(result.items).toHaveLength(2);
    expect(result.page).toBe(2);
  });

  test("returns last page with remaining items", () => {
    const result = paginateRecordings(MOCK_RECORDINGS, 3, 2);
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(3);
  });

  test("clamps page to valid range", () => {
    const result = paginateRecordings(MOCK_RECORDINGS, 100, 2);
    expect(result.page).toBe(3); // max page
    expect(result.items).toHaveLength(1);
  });

  test("clamps page to 1 for invalid", () => {
    const result = paginateRecordings(MOCK_RECORDINGS, 0, 10);
    expect(result.page).toBe(1);
  });

  test("handles empty array", () => {
    const result = paginateRecordings([], 1, 10);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });
});
