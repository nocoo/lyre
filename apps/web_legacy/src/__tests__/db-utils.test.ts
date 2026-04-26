import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, rmdirSync } from "fs";
import { resolveDbPath, ensureDir } from "@lyre/api/db";

describe("resolveDbPath", () => {
  let savedLyreDb: string | undefined;

  beforeEach(async () => {
    savedLyreDb = process.env.LYRE_DB;
  });

  afterEach(async () => {
    if (savedLyreDb === undefined) {
      delete process.env.LYRE_DB;
    } else {
      process.env.LYRE_DB = savedLyreDb;
    }
  });

  test("returns default path when LYRE_DB is not set", async () => {
    delete process.env.LYRE_DB;
    expect(resolveDbPath()).toBe("database/lyre.db");
  });

  test("returns LYRE_DB when set", async () => {
    process.env.LYRE_DB = "/tmp/custom.db";
    expect(resolveDbPath()).toBe("/tmp/custom.db");
  });
});

describe("ensureDir", () => {
  const testDir = "/tmp/lyre-test-ensure-dir-" + Date.now();
  const testFile = `${testDir}/sub/test.db`;

  afterEach(async () => {
    // Cleanup
    try {
      rmdirSync(`${testDir}/sub`);
      rmdirSync(testDir);
    } catch {
      // ignore
    }
  });

  test("creates parent directories for a file path", async () => {
    expect(existsSync(`${testDir}/sub`)).toBe(false);
    ensureDir(testFile);
    expect(existsSync(`${testDir}/sub`)).toBe(true);
  });

  test("does nothing for :memory:", async () => {
    // Should not throw or create anything
    ensureDir(":memory:");
  });

  test("does not fail when directory already exists", async () => {
    ensureDir(testFile);
    // Call again — should not throw
    ensureDir(testFile);
    expect(existsSync(`${testDir}/sub`)).toBe(true);
  });
});
