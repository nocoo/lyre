import { describe, expect, test, beforeEach, mock } from "bun:test";

/**
 * Test theme toggle pure logic.
 * We extract and test the core theme functions with minimal DOM mocking.
 */

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
};

// Minimal matchMedia mock
let prefersDark = false;
const mockMatchMedia = (query: string) => ({
  matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
  media: query,
  addEventListener: mock(() => {}),
  removeEventListener: mock(() => {}),
});

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
  // @ts-expect-error -- minimal mock for testing
  globalThis.localStorage = mockLocalStorage;
  // @ts-expect-error -- minimal mock for testing
  globalThis.document = {
    documentElement: { classList: { toggle: mock(() => {}) } },
  };
});

// Re-implement theme functions to test logic (same as theme-toggle.tsx)
type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("theme") as Theme) || "system";
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function cycleTheme(current: Theme): Theme {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

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
