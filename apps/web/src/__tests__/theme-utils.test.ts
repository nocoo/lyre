import { describe, expect, test } from "vitest";
import {
  getStoredTheme,
  getSystemTheme,
  cycleTheme,
} from "@/lib/theme-utils";

describe("theme-utils", () => {
  test("cycleTheme rotates system → light → dark → system", () => {
    expect(cycleTheme("system")).toBe("light");
    expect(cycleTheme("light")).toBe("dark");
    expect(cycleTheme("dark")).toBe("system");
  });

  test("getStoredTheme returns 'system' when window is undefined", () => {
    // SSR-style guard
    const orig = globalThis.window;
    // @ts-expect-error — emulating no-window environment
    delete globalThis.window;
    try {
      expect(getStoredTheme()).toBe("system");
      expect(getSystemTheme()).toBe("light");
    } finally {
      globalThis.window = orig;
    }
  });
});
