import { describe, expect, test } from "bun:test";
import {
  monthLabel,
  monthLabelFull,
  formatTotalDuration,
  buildRecordingStatCards,
  buildOssStatCards,
  statusLabel,
  statusColorIndex,
  type RecordingStats,
  type OssBucketStats,
} from "@/lib/dashboard-vm";

// ── monthLabel ──

describe("monthLabel", () => {
  test("converts YYYY-MM to short month", () => {
    expect(monthLabel("2025-01")).toBe("Jan");
    expect(monthLabel("2025-06")).toBe("Jun");
    expect(monthLabel("2025-12")).toBe("Dec");
  });

  test("returns input for invalid format", () => {
    expect(monthLabel("invalid")).toBe("invalid");
    expect(monthLabel("")).toBe("");
  });
});

// ── monthLabelFull ──

describe("monthLabelFull", () => {
  test("converts YYYY-MM to full label", () => {
    expect(monthLabelFull("2025-01")).toBe("Jan 2025");
    expect(monthLabelFull("2026-12")).toBe("Dec 2026");
  });

  test("returns input for invalid format", () => {
    expect(monthLabelFull("bad")).toBe("bad");
  });
});

// ── formatTotalDuration ──

describe("formatTotalDuration", () => {
  test("returns '0m' for zero", () => {
    expect(formatTotalDuration(0)).toBe("0m");
  });

  test("returns '0m' for negative", () => {
    expect(formatTotalDuration(-100)).toBe("0m");
  });

  test("formats minutes only", () => {
    expect(formatTotalDuration(300)).toBe("5m");
    expect(formatTotalDuration(59)).toBe("0m"); // < 1 minute but > 0 seconds
  });

  test("formats hours only", () => {
    expect(formatTotalDuration(7200)).toBe("2h");
  });

  test("formats hours and minutes", () => {
    expect(formatTotalDuration(3900)).toBe("1h 5m");
    expect(formatTotalDuration(5400)).toBe("1h 30m");
  });

  test("handles large durations", () => {
    expect(formatTotalDuration(86400)).toBe("24h");
  });
});

// ── statusLabel ──

describe("statusLabel", () => {
  test("maps all statuses", () => {
    expect(statusLabel("uploaded")).toBe("Uploaded");
    expect(statusLabel("transcribing")).toBe("Transcribing");
    expect(statusLabel("completed")).toBe("Completed");
    expect(statusLabel("failed")).toBe("Failed");
  });
});

// ── statusColorIndex ──

describe("statusColorIndex", () => {
  test("returns unique indices for each status", () => {
    const indices = new Set([
      statusColorIndex("uploaded"),
      statusColorIndex("transcribing"),
      statusColorIndex("completed"),
      statusColorIndex("failed"),
    ]);
    expect(indices.size).toBe(4);
  });

  test("returns valid chart color indices (0-23)", () => {
    for (const status of ["uploaded", "transcribing", "completed", "failed"] as const) {
      const idx = statusColorIndex(status);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(24);
    }
  });
});

// ── buildRecordingStatCards ──

describe("buildRecordingStatCards", () => {
  const stats: RecordingStats = {
    totalCount: 100,
    totalDuration: 36000, // 10 hours
    totalSize: 1024 * 1024 * 500, // 500 MB
    completedCount: 80,
    failedCount: 5,
    transcribingCount: 10,
    uploadedCount: 5,
    avgDuration: 360, // 6 min
    avgSize: 1024 * 1024 * 5, // 5 MB
    byMonth: [],
    durationByMonth: [],
    byStatus: [],
    byFormat: [],
  };

  test("returns 4 stat cards", () => {
    const cards = buildRecordingStatCards(stats);
    expect(cards).toHaveLength(4);
  });

  test("includes total recordings", () => {
    const cards = buildRecordingStatCards(stats);
    const total = cards.find((c) => c.label === "Total Recordings");
    expect(total).toBeDefined();
    expect(total!.value).toBe("100");
  });

  test("includes total duration", () => {
    const cards = buildRecordingStatCards(stats);
    const duration = cards.find((c) => c.label === "Total Duration");
    expect(duration).toBeDefined();
    expect(duration!.value).toBe("10h");
  });

  test("includes total size", () => {
    const cards = buildRecordingStatCards(stats);
    const size = cards.find((c) => c.label === "Total Size");
    expect(size).toBeDefined();
    expect(size!.value).toBe("500.0 MB");
  });

  test("includes completion rate", () => {
    const cards = buildRecordingStatCards(stats);
    const rate = cards.find((c) => c.label === "Completion Rate");
    expect(rate).toBeDefined();
    expect(rate!.value).toBe("80%");
    expect(rate!.subtitle).toBe("80 of 100");
  });

  test("handles zero recordings", () => {
    const empty: RecordingStats = {
      ...stats,
      totalCount: 0,
      totalDuration: 0,
      totalSize: 0,
      completedCount: 0,
      avgDuration: 0,
      avgSize: 0,
    };
    const cards = buildRecordingStatCards(empty);
    const rate = cards.find((c) => c.label === "Completion Rate");
    expect(rate!.value).toBe("0%");
  });
});

// ── buildOssStatCards ──

describe("buildOssStatCards", () => {
  const oss: OssBucketStats = {
    uploads: {
      totalFiles: 50,
      totalSize: 1024 * 1024 * 200,
      orphanFiles: 3,
      orphanSize: 1024 * 1024 * 10,
    },
    results: {
      totalFiles: 30,
      totalSize: 1024 * 1024 * 100,
      orphanFiles: 2,
      orphanSize: 1024 * 1024 * 5,
    },
    total: {
      files: 80,
      size: 1024 * 1024 * 300,
      orphanFiles: 5,
      orphanSize: 1024 * 1024 * 15,
    },
    sizeByMonth: [],
  };

  test("returns 3 stat cards", () => {
    const cards = buildOssStatCards(oss);
    expect(cards).toHaveLength(3);
  });

  test("includes total files", () => {
    const cards = buildOssStatCards(oss);
    const total = cards.find((c) => c.label === "Total Files");
    expect(total).toBeDefined();
    expect(total!.value).toBe("80");
  });

  test("includes total storage", () => {
    const cards = buildOssStatCards(oss);
    const storage = cards.find((c) => c.label === "Total Storage");
    expect(storage).toBeDefined();
    expect(storage!.value).toBe("300.0 MB");
  });

  test("includes orphan files", () => {
    const cards = buildOssStatCards(oss);
    const orphan = cards.find((c) => c.label === "Orphan Files");
    expect(orphan).toBeDefined();
    expect(orphan!.value).toBe("5");
    expect(orphan!.subtitle).toContain("reclaimable");
  });

  test("shows 'all clean' when no orphans", () => {
    const clean: OssBucketStats = {
      ...oss,
      total: { ...oss.total, orphanFiles: 0, orphanSize: 0 },
    };
    const cards = buildOssStatCards(clean);
    const orphan = cards.find((c) => c.label === "Orphan Files");
    expect(orphan!.subtitle).toBe("all clean");
  });
});
