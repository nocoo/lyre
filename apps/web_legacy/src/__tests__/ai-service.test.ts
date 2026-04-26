/**
 * AI service tests.
 *
 * Tests the lyre-specific helpers in services/ai (provider re-export shape +
 * summary prompt logic). The provider registry, config resolution, and client
 * creation are owned by `@nocoo/next-ai` and tested in that package.
 */

import { describe, expect, test } from "bun:test";
import {
  AI_PROVIDERS,
  ALL_PROVIDER_IDS,
  CUSTOM_PROVIDER_INFO,
  getProviderConfig,
  isValidProvider,
  generateSummary,
  buildSummaryPrompt,
} from "@lyre/api/services/ai";

describe("AI_PROVIDERS (re-exported registry)", () => {
  test("contains the expected built-in providers", async () => {
    const ids = Object.keys(AI_PROVIDERS);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("glm");
    expect(ids).toContain("minimax");
    expect(ids).toContain("aihubmix");
  });

  test("each provider info has required fields", async () => {
    for (const [id, p] of Object.entries(AI_PROVIDERS)) {
      expect(id).toBe(p.id);
      expect(p.label).toBeTruthy();
      expect(p.baseURL).toMatch(/^https:\/\//);
      expect(p.sdkType).toMatch(/^(anthropic|openai)$/);
      expect(Array.isArray(p.models)).toBe(true);
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.defaultModel).toBeTruthy();
      expect(p.models).toContain(p.defaultModel);
    }
  });
});

describe("ALL_PROVIDER_IDS", () => {
  test("includes all built-in providers plus custom", async () => {
    expect(ALL_PROVIDER_IDS).toContain("anthropic");
    expect(ALL_PROVIDER_IDS).toContain("minimax");
    expect(ALL_PROVIDER_IDS).toContain("glm");
    expect(ALL_PROVIDER_IDS).toContain("aihubmix");
    expect(ALL_PROVIDER_IDS).toContain("custom");
  });
});

describe("CUSTOM_PROVIDER_INFO", () => {
  test("has id, label, empty models, empty defaultModel", async () => {
    expect(CUSTOM_PROVIDER_INFO.id).toBe("custom");
    expect(CUSTOM_PROVIDER_INFO.label).toBe("Custom");
    expect(CUSTOM_PROVIDER_INFO.models).toEqual([]);
    expect(CUSTOM_PROVIDER_INFO.defaultModel).toBe("");
  });
});

describe("isValidProvider", () => {
  test("returns true for built-in providers and custom", async () => {
    expect(isValidProvider("anthropic")).toBe(true);
    expect(isValidProvider("glm")).toBe(true);
    expect(isValidProvider("minimax")).toBe(true);
    expect(isValidProvider("aihubmix")).toBe(true);
    expect(isValidProvider("custom")).toBe(true);
  });

  test("returns false for unknown strings", async () => {
    expect(isValidProvider("invalid")).toBe(false);
    expect(isValidProvider("")).toBe(false);
  });
});

describe("getProviderConfig", () => {
  test("returns config for valid built-in provider", async () => {
    const config = getProviderConfig("anthropic");
    expect(config).toBeDefined();
    expect(config!.id).toBe("anthropic");
    expect(config!.baseURL).toBe("https://api.anthropic.com/v1");
    expect(config!.sdkType).toBe("anthropic");
  });

  test("returns undefined for custom provider", async () => {
    expect(getProviderConfig("custom")).toBeUndefined();
  });

  test("returns undefined for unknown provider", async () => {
    expect(getProviderConfig("invalid")).toBeUndefined();
  });
});

describe("buildSummaryPrompt", () => {
  test("builds prompt with transcript wrapped in tags", async () => {
    const prompt = buildSummaryPrompt("Meeting notes here.");
    expect(prompt).toContain("<transcript>");
    expect(prompt).toContain("Meeting notes here.");
    expect(prompt).toContain("</transcript>");
  });

  test("throws on empty transcript", async () => {
    expect(() => buildSummaryPrompt("")).toThrow("Transcript is empty");
  });

  test("throws on whitespace-only transcript", async () => {
    expect(() => buildSummaryPrompt("   \n  ")).toThrow("Transcript is empty");
  });
});

describe("generateSummary", () => {
  test("calls generate function and returns text result", async () => {
    const mockGenerate = async () => ({ text: "This is a summary." });
    const result = await generateSummary("Hello world.", mockGenerate);
    expect(result).toBe("This is a summary.");
  });

  test("throws on empty transcript", async () => {
    const mockGenerate = async () => ({ text: "summary" });
    await expect(generateSummary("", mockGenerate)).rejects.toThrow(
      "Transcript is empty",
    );
  });

  test("passes prompt containing transcript to generate function", async () => {
    let capturedPrompt = "";
    const mockGenerate = async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return { text: "summary" };
    };
    await generateSummary("Meeting notes here.", mockGenerate);
    expect(capturedPrompt).toContain("<transcript>");
    expect(capturedPrompt).toContain("Meeting notes here.");
    expect(capturedPrompt).toContain("</transcript>");
  });
});
