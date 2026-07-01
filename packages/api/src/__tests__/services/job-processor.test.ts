/**
 * Tests for the auto-summarize path inside job-processor.
 *
 * Focuses on the state-machine contract observed via
 * `recordings.aiSummaryStatus` / `aiSummary` / `aiSummaryError`:
 *
 *   - Preflight gates (autoSummarize disabled, no provider, empty transcript)
 *     leave status untouched at `null` — the recording is "never attempted".
 *   - A committed run flips through `running` → `succeeded` on happy path.
 *   - Failures land on `status=failed` with a human-readable error, and
 *     clear any partial `aiSummary` (nothing half-written survives).
 *   - Abort/timeout errors surface a friendly message.
 */
import { describe, expect, it } from "vitest";
import type { generateText } from "ai";
import { autoSummarize } from "../../services/job-processor";
import { getTestDb } from "../_fixtures/test-db";
import { seedTestUser, testRepos } from "../_fixtures/runtime-context";
import { makeSettingsRepo } from "../../db/repositories";

async function seedRecording(userId: string, id = "rec-1"): Promise<void> {
  await testRepos().recordings.create({
    id,
    userId,
    title: "t",
    description: null,
    fileName: "a.m4a",
    fileSize: null,
    duration: null,
    format: null,
    sampleRate: null,
    ossKey: "k",
    status: "completed",
  });
}

async function configureAi(userId: string): Promise<void> {
  const settings = makeSettingsRepo(getTestDb());
  await settings.upsert(userId, "ai.autoSummarize", "true");
  await settings.upsert(userId, "ai.provider", "anthropic");
  await settings.upsert(userId, "ai.apiKey", "sk-test");
  await settings.upsert(userId, "ai.model", "claude-3-5-haiku-20241022");
}

/** Type-compatible stub matching the `generateText` signature we use. */
function stubGenerate(impl: () => Promise<{ text: string }>): typeof generateText {
  return impl as unknown as typeof generateText;
}

describe("autoSummarize", () => {
  it("no-ops when auto-summarize is disabled (status stays null)", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    // Settings has no `ai.autoSummarize` key → gate returns early.

    const called = { count: 0 };
    await autoSummarize(
      user.id,
      "rec-1",
      "some transcript",
      getTestDb(),
      stubGenerate(async () => {
        called.count++;
        return { text: "shouldn't be called" };
      }),
    );

    expect(called.count).toBe(0);
    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBeNull();
    expect(rec?.aiSummary).toBeNull();
    expect(rec?.aiSummaryError).toBeNull();
  });

  it("no-ops when provider or apiKey missing (status stays null)", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    const settings = makeSettingsRepo(getTestDb());
    await settings.upsert(user.id, "ai.autoSummarize", "true");
    // provider + apiKey deliberately absent

    const called = { count: 0 };
    await autoSummarize(
      user.id,
      "rec-1",
      "some transcript",
      getTestDb(),
      stubGenerate(async () => {
        called.count++;
        return { text: "" };
      }),
    );

    expect(called.count).toBe(0);
    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBeNull();
  });

  it("no-ops on empty transcript (status stays null)", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    await configureAi(user.id);

    const called = { count: 0 };
    await autoSummarize(
      user.id,
      "rec-1",
      "   \n\t  ",
      getTestDb(),
      stubGenerate(async () => {
        called.count++;
        return { text: "" };
      }),
    );

    expect(called.count).toBe(0);
    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBeNull();
  });

  it("writes succeeded state and the summary text on happy path", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    await configureAi(user.id);

    await autoSummarize(
      user.id,
      "rec-1",
      "hello world transcript",
      getTestDb(),
      stubGenerate(async () => ({ text: "Short summary of hello world." })),
    );

    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBe("succeeded");
    expect(rec?.aiSummary).toBe("Short summary of hello world.");
    expect(rec?.aiSummaryError).toBeNull();
  });

  it("clears any prior summary while running and restores nothing on failure", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    // Seed a prior summary that must be cleared during a fresh run.
    await testRepos().recordings.update("rec-1", {
      aiSummary: "stale content",
      aiSummaryStatus: "succeeded",
    });
    await configureAi(user.id);

    await autoSummarize(
      user.id,
      "rec-1",
      "hello world transcript",
      getTestDb(),
      stubGenerate(async () => {
        throw new Error("provider is on fire");
      }),
    );

    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBe("failed");
    expect(rec?.aiSummary).toBeNull();
    expect(rec?.aiSummaryError).toContain("provider is on fire");
  });

  it("reports empty AI response as a failed run, not silent success", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    await configureAi(user.id);

    await autoSummarize(
      user.id,
      "rec-1",
      "hello world transcript",
      getTestDb(),
      stubGenerate(async () => ({ text: "   " })),
    );

    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBe("failed");
    expect(rec?.aiSummary).toBeNull();
    expect(rec?.aiSummaryError).toMatch(/empty/i);
  });

  it("surfaces a friendly timeout message for AbortError", async () => {
    const user = await seedTestUser();
    await seedRecording(user.id);
    await configureAi(user.id);

    await autoSummarize(
      user.id,
      "rec-1",
      "hello world transcript",
      getTestDb(),
      stubGenerate(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );

    const rec = await testRepos().recordings.findById("rec-1");
    expect(rec?.aiSummaryStatus).toBe("failed");
    expect(rec?.aiSummaryError).toMatch(/timed out/i);
  });
});
