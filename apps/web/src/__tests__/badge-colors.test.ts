import { describe, expect, it } from "bun:test";
import { hashString, getTagColor } from "@/lib/badge-colors";

describe("hashString", () => {
  it("returns a non-negative integer for ASCII strings", () => {
    expect(hashString("hello")).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashString("hello"))).toBe(true);
  });

  it("returns the same hash for the same input", () => {
    expect(hashString("work")).toBe(hashString("work"));
    expect(hashString("meeting")).toBe(hashString("meeting"));
  });

  it("returns different hashes for different inputs", () => {
    expect(hashString("alpha")).not.toBe(hashString("beta"));
  });

  it("handles Unicode / CJK characters", () => {
    const hash = hashString("会议记录");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it("handles empty string", () => {
    expect(hashString("")).toBe(0);
  });

  it("handles single character", () => {
    expect(hashString("a")).toBeGreaterThan(0);
  });
});

describe("getTagColor", () => {
  it("returns an object with bg and text classes", () => {
    const color = getTagColor("test");
    expect(color).toHaveProperty("bg");
    expect(color).toHaveProperty("text");
    expect(color.bg).toContain("bg-");
    expect(color.text).toContain("text-");
  });

  it("returns the same color for the same tag name", () => {
    expect(getTagColor("project")).toEqual(getTagColor("project"));
  });

  it("returns consistent colors for CJK tag names", () => {
    const color1 = getTagColor("日报");
    const color2 = getTagColor("日报");
    expect(color1).toEqual(color2);
  });

  it("returns a color from the soft palette pattern", () => {
    const color = getTagColor("test");
    expect(color.bg).toMatch(/bg-\w+-500\/15/);
    expect(color.text).toMatch(/text-\w+-600/);
  });

  it("distributes tags across different colors", () => {
    const colors = new Set<string>();
    const tags = [
      "work", "personal", "meeting", "notes", "idea",
      "todo", "review", "draft", "final", "archive",
      "urgent", "backup",
    ];
    for (const tag of tags) {
      colors.add(getTagColor(tag).bg);
    }
    // With 12 tags and 12 palette entries, expect at least a few distinct colors
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });
});
