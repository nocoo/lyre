/**
 * AI service tests.
 *
 * Tests the AI provider configuration, client creation, and summary generation.
 */

import { describe, expect, test } from "bun:test";
import {
  AI_PROVIDERS,
  getProviderConfig,
  resolveAiConfig,
  createAiClient,
  generateSummary,
  buildSummaryPrompt,
  type AiProvider,
  type AiConfig,
} from "@/services/ai";

describe("AI_PROVIDERS", () => {
  test("has 4 providers", () => {
    expect(Object.keys(AI_PROVIDERS)).toHaveLength(4);
  });

  test("each provider has id, label, baseURL, defaultModel", () => {
    for (const [id, p] of Object.entries(AI_PROVIDERS)) {
      expect(id).toBe(p.id);
      expect(p.label).toBeTruthy();
      expect(p.baseURL).toMatch(/^https:\/\//);
      expect(p.defaultModel).toBeTruthy();
    }
  });

  test("contains expected provider ids", () => {
    const ids = Object.keys(AI_PROVIDERS);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("glm");
    expect(ids).toContain("minimax");
    expect(ids).toContain("aihubmix");
  });
});

describe("getProviderConfig", () => {
  test("returns config for valid provider", () => {
    const config = getProviderConfig("anthropic");
    expect(config).toBeDefined();
    expect(config!.id).toBe("anthropic");
    expect(config!.baseURL).toBe("https://api.anthropic.com/v1");
  });

  test("returns undefined for invalid provider", () => {
    expect(getProviderConfig("invalid" as AiProvider)).toBeUndefined();
  });
});

describe("resolveAiConfig", () => {
  test("uses provider defaults when model is empty", () => {
    const config = resolveAiConfig({
      provider: "anthropic",
      apiKey: "sk-test",
      model: "",
    });
    expect(config.baseURL).toBe("https://api.anthropic.com/v1");
    expect(config.model).toBe(AI_PROVIDERS.anthropic.defaultModel);
    expect(config.apiKey).toBe("sk-test");
  });

  test("uses custom model when provided", () => {
    const config = resolveAiConfig({
      provider: "anthropic",
      apiKey: "sk-test",
      model: "claude-3-haiku-20240307",
    });
    expect(config.model).toBe("claude-3-haiku-20240307");
  });

  test("resolves different providers correctly", () => {
    const glm = resolveAiConfig({ provider: "glm", apiKey: "k", model: "" });
    expect(glm.baseURL).toBe("https://open.bigmodel.cn/api/anthropic");

    const mm = resolveAiConfig({ provider: "minimax", apiKey: "k", model: "" });
    expect(mm.baseURL).toBe("https://api.minimaxi.com/anthropic");

    const hub = resolveAiConfig({ provider: "aihubmix", apiKey: "k", model: "" });
    expect(hub.baseURL).toBe("https://aihubmix.com/v1");
  });

  test("throws when provider is unknown", () => {
    expect(() =>
      resolveAiConfig({ provider: "bad" as AiProvider, apiKey: "k", model: "" }),
    ).toThrow("Unknown AI provider");
  });

  test("throws when apiKey is empty", () => {
    expect(() =>
      resolveAiConfig({ provider: "anthropic", apiKey: "", model: "" }),
    ).toThrow("API key is required");
  });
});

describe("createAiClient", () => {
  test("creates a provider instance", () => {
    const config: AiConfig = {
      provider: "anthropic",
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      model: "claude-sonnet-4-20250514",
    };
    const client = createAiClient(config);
    expect(client).toBeDefined();
    // The client is a function that creates model references
    expect(typeof client).toBe("function");
  });
});

describe("buildSummaryPrompt", () => {
  test("builds prompt with transcript wrapped in tags", () => {
    const prompt = buildSummaryPrompt("Meeting notes here.");
    expect(prompt).toContain("<transcript>");
    expect(prompt).toContain("Meeting notes here.");
    expect(prompt).toContain("</transcript>");
  });

  test("throws on empty transcript", () => {
    expect(() => buildSummaryPrompt("")).toThrow("Transcript is empty");
  });

  test("throws on whitespace-only transcript", () => {
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
