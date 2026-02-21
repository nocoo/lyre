import { describe, expect, test } from "bun:test";
import { cn, hashString, getAvatarColor } from "@/lib/utils";

describe("cn utility", () => {
  test("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  test("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  test("merges tailwind classes correctly", () => {
    const result = cn("px-2 py-1", "px-4");
    expect(result).toContain("px-4");
    expect(result).toContain("py-1");
    expect(result).not.toContain("px-2");
  });

  test("handles empty inputs", () => {
    expect(cn()).toBe("");
  });

  test("handles undefined and null", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });
});

describe("hashString", () => {
  test("returns a non-negative number", () => {
    expect(hashString("hello")).toBeGreaterThanOrEqual(0);
  });

  test("returns same hash for same input", () => {
    expect(hashString("test")).toBe(hashString("test"));
  });

  test("returns different hash for different input", () => {
    expect(hashString("alice")).not.toBe(hashString("bob"));
  });

  test("handles empty string", () => {
    expect(hashString("")).toBe(0);
  });
});

describe("getAvatarColor", () => {
  test("returns a bg- class string", () => {
    expect(getAvatarColor("Alice")).toMatch(/^bg-\w+-\d{3}$/);
  });

  test("returns same color for same name", () => {
    expect(getAvatarColor("Bob")).toBe(getAvatarColor("Bob"));
  });

  test("returns a valid tailwind color class", () => {
    const color = getAvatarColor("Charlie");
    expect(color).toMatch(/^bg-\w+-\d{3}$/);
  });
});
