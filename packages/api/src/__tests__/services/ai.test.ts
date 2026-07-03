/**
 * Unit tests for the summary prompt builders.
 *
 * `buildSummaryPrompt` is the auto/cron path — nothing but the transcript.
 * `buildSummaryPromptWithFeedback` is the manual Regenerate path — folds
 * in the previous summary and/or a one-shot user complaint. The four
 * fold combinations exercised here match the ones the route actually
 * sends: (neither), (prev only), (feedback only), (both).
 */
import { describe, expect, it } from "vitest";
import {
  buildSummaryPrompt,
  buildSummaryPromptWithFeedback,
} from "../../services/ai";

describe("buildSummaryPrompt", () => {
  it("wraps the transcript inside <transcript> and preserves it verbatim", () => {
    const out = buildSummaryPrompt("Line one.\nLine two.");
    expect(out).toContain("<transcript>\nLine one.\nLine two.\n</transcript>");
  });

  it("pins output language to Simplified Chinese regardless of transcript language", () => {
    // Product decision: audience reads Chinese. English-only transcripts
    // still get a Chinese summary. If someone tweaks the prompt in the
    // future this pin trips immediately.
    const out = buildSummaryPrompt("Hello world.");
    expect(out).toMatch(/Simplified Chinese|简体中文/);
  });

  it("throws when the transcript is only whitespace", () => {
    expect(() => buildSummaryPrompt("   \n\t")).toThrow(/empty/i);
  });
});

describe("buildSummaryPromptWithFeedback", () => {
  const T = "The meeting covered Q3 goals and next quarter's roadmap.";

  it("with neither previousSummary nor feedback → matches buildSummaryPrompt exactly", () => {
    // Auto/cron parity guard: any degenerate call MUST fall back to the
    // exact original prompt so we never regress the base behavior.
    expect(buildSummaryPromptWithFeedback(T, {})).toBe(buildSummaryPrompt(T));
    expect(
      buildSummaryPromptWithFeedback(T, {
        previousSummary: "",
        feedback: "   ",
      }),
    ).toBe(buildSummaryPrompt(T));
    expect(
      buildSummaryPromptWithFeedback(T, {
        previousSummary: null,
        feedback: null,
      }),
    ).toBe(buildSummaryPrompt(T));
  });

  it("with previousSummary only → includes <previous-summary>, no <user-feedback>", () => {
    const prev = "Old summary that missed the action items.";
    const out = buildSummaryPromptWithFeedback(T, { previousSummary: prev });
    expect(out).toContain(`<previous-summary>\n${prev}\n</previous-summary>`);
    expect(out).not.toContain("<user-feedback>");
    expect(out).toContain(`<transcript>\n${T}\n</transcript>`);
    expect(out).toContain("Do not simply repeat the previous version");
  });

  it("with feedback only → includes <user-feedback>, no <previous-summary>", () => {
    const fb = "Focus more on action items and skip the intro.";
    const out = buildSummaryPromptWithFeedback(T, { feedback: fb });
    expect(out).toContain(`<user-feedback>\n${fb}\n</user-feedback>`);
    expect(out).not.toContain("<previous-summary>");
    expect(out).toContain(`<transcript>\n${T}\n</transcript>`);
    expect(out).toMatch(/user was unsatisfied.*left this feedback/i);
  });

  it("with both → includes both sections, transcript still present", () => {
    const prev = "Old summary v1.";
    const fb = "Add owner names.";
    const out = buildSummaryPromptWithFeedback(T, {
      previousSummary: prev,
      feedback: fb,
    });
    expect(out).toContain(`<previous-summary>\n${prev}\n</previous-summary>`);
    expect(out).toContain(`<user-feedback>\n${fb}\n</user-feedback>`);
    expect(out).toContain(`<transcript>\n${T}\n</transcript>`);
    // Ordering matters for the LLM — instruction line + previous first,
    // then feedback, then transcript. Assert with indices so a reshuffle
    // is caught explicitly.
    const iInstr = out.indexOf("Do not simply repeat");
    const iPrev = out.indexOf("<previous-summary>");
    const iFb = out.indexOf("<user-feedback>");
    const iTx = out.indexOf("<transcript>");
    expect(iInstr).toBeGreaterThan(-1);
    expect(iInstr).toBeLessThan(iPrev);
    expect(iPrev).toBeLessThan(iFb);
    expect(iFb).toBeLessThan(iTx);
  });

  it("injects previousSummary / feedback verbatim without escaping", () => {
    // The route accepts user-typed feedback and passes it straight in.
    // We do NOT escape angle brackets — the outer tag wrapper is what
    // signals "user content" to the LLM. This test pins that contract so
    // a well-meaning later "sanitize" doesn't silently mutate user text.
    const fb = "Please <emphasize> the numbers & keep it > 3 bullets.";
    const out = buildSummaryPromptWithFeedback(T, { feedback: fb });
    expect(out).toContain(fb);
  });

  it("still throws on empty transcript regardless of feedback", () => {
    expect(() =>
      buildSummaryPromptWithFeedback("  ", { feedback: "anything" }),
    ).toThrow(/empty/i);
  });

  it("pins output language to Simplified Chinese on all fold combinations", () => {
    // Same product pin as the base prompt. Test all three non-degenerate
    // branches so a future edit to just one instruction line can't
    // silently drop the language directive.
    for (const opts of [
      { previousSummary: "old" },
      { feedback: "shorter please" },
      { previousSummary: "old", feedback: "shorter" },
    ] as const) {
      const out = buildSummaryPromptWithFeedback(T, opts);
      expect(out).toMatch(/Simplified Chinese|简体中文/);
    }
  });
});
