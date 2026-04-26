import { describe, expect, test } from "bun:test";
import { cn, hashString, getAvatarColor } from "@/lib/utils";

describe("utils", () => {
  test("cn merges tailwind classes and dedupes conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    const falsy: false | string = false;
    expect(cn("text-red-500", falsy && "text-blue-500")).toBe("text-red-500");
  });

  test("hashString is deterministic and non-negative", () => {
    expect(hashString("foo")).toBe(hashString("foo"));
    expect(hashString("foo")).toBeGreaterThanOrEqual(0);
  });

  test("getAvatarColor is stable per name and returns a tailwind bg-* class", () => {
    const a = getAvatarColor("Zheng Li");
    const b = getAvatarColor("Zheng Li");
    expect(a).toBe(b);
    expect(a.startsWith("bg-")).toBe(true);
  });
});
