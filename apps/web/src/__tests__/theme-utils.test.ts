import { afterEach, describe, expect, test } from "vitest";
import {
  getStoredTheme,
  getSystemTheme,
  cycleTheme,
} from "@/lib/theme-utils";

describe("theme-utils", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { window?: unknown }).window;
  });

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

  test("getStoredTheme reads from localStorage when window is defined", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage: Pick<Storage, "getItem"> }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
    };
    (globalThis as { window: unknown }).window = {};
    store.set("theme", "dark");
    expect(getStoredTheme()).toBe("dark");
    store.delete("theme");
    // falls back to "system" when missing
    expect(getStoredTheme()).toBe("system");
  });

  test("getSystemTheme reads matchMedia when window is defined", () => {
    const fakeWindow = {
      matchMedia: (q: string) => ({ matches: q.includes("dark") }),
    };
    (globalThis as { window: unknown }).window = fakeWindow;
    expect(getSystemTheme()).toBe("dark");
    fakeWindow.matchMedia = () => ({ matches: false });
    expect(getSystemTheme()).toBe("light");
  });
});

