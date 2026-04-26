import { describe, expect, test, beforeEach, mock } from "bun:test";
import { getStoredTheme, getSystemTheme, cycleTheme } from "@/lib/theme-utils";
import type { Theme } from "@/lib/theme-utils";

// Minimal localStorage mock
let store: Record<string, string> = {};

const mockLocalStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    store = {};
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
  get length() {
    return Object.keys(store).length;
  },
};

// Minimal matchMedia mock
let prefersDark = false;
const mockMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
    media: query,
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    addListener: mock(() => {}),
    removeListener: mock(() => {}),
    onchange: null,
    dispatchEvent: () => true,
  }) as unknown as MediaQueryList;

// Set up global mocks
beforeEach(() => {
  store = {};
  prefersDark = false;
  // @ts-expect-error -- minimal mock for testing
  globalThis.window = {
    localStorage: mockLocalStorage,
    matchMedia: mockMatchMedia,
    dispatchEvent: mock(() => true),
  };
  globalThis.localStorage = mockLocalStorage;
  globalThis.document = {
    documentElement: { classList: { toggle: mock(() => true) } },
  } as unknown as Document;
});

describe("getStoredTheme", () => {
  test("returns 'system' when nothing stored", () => {
    expect(getStoredTheme()).toBe("system");
  });

  test("returns stored theme", () => {
    store["theme"] = "dark";
    expect(getStoredTheme()).toBe("dark");
  });

  test("returns stored light theme", () => {
    store["theme"] = "light";
    expect(getStoredTheme()).toBe("light");
  });
});

describe("getSystemTheme", () => {
  test("returns 'light' when system prefers light", () => {
    prefersDark = false;
    expect(getSystemTheme()).toBe("light");
  });

  test("returns 'dark' when system prefers dark", () => {
    prefersDark = true;
    expect(getSystemTheme()).toBe("dark");
  });
});

describe("cycleTheme", () => {
  test("system -> light", () => {
    expect(cycleTheme("system")).toBe("light");
  });

  test("light -> dark", () => {
    expect(cycleTheme("light")).toBe("dark");
  });

  test("dark -> system", () => {
    expect(cycleTheme("dark")).toBe("system");
  });

  test("full cycle returns to start", () => {
    let theme: Theme = "system";
    theme = cycleTheme(theme);
    expect(theme).toBe("light");
    theme = cycleTheme(theme);
    expect(theme).toBe("dark");
    theme = cycleTheme(theme);
    expect(theme).toBe("system");
  });
});
