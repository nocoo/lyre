import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, rmdirSync } from "fs";
import { resolveDbPath, ensureDir } from "@/db/index";

describe("resolveDbPath", () => {
  let savedLyreDb: string | undefined;

  beforeEach(() => {
    savedLyreDb = process.env.LYRE_DB;
  });

  afterEach(() => {
    if (savedLyreDb === undefined) {
      delete process.env.LYRE_DB;
    } else {
      process.env.LYRE_DB = savedLyreDb;
    }
  });

  test("returns default path when LYRE_DB is not set", () => {
    delete process.env.LYRE_DB;
    expect(resolveDbPath()).toBe("database/lyre.db");
  });

  test("returns LYRE_DB when set", () => {
    process.env.LYRE_DB = "/tmp/custom.db";
    expect(resolveDbPath()).toBe("/tmp/custom.db");
  });
});

describe("ensureDir", () => {
  const testDir = "/tmp/lyre-test-ensure-dir-" + Date.now();
  const testFile = `${testDir}/sub/test.db`;

  afterEach(() => {
    // Cleanup
    try {
      rmdirSync(`${testDir}/sub`);
      rmdirSync(testDir);
    } catch {
      // ignore
    }
  });

  test("creates parent directories for a file path", () => {
    expect(existsSync(`${testDir}/sub`)).toBe(false);
    ensureDir(testFile);
    expect(existsSync(`${testDir}/sub`)).toBe(true);
  });

  test("does nothing for :memory:", () => {
    // Should not throw or create anything
    ensureDir(":memory:");
  });

  test("does not fail when directory already exists", () => {
    ensureDir(testFile);
    // Call again — should not throw
    ensureDir(testFile);
    expect(existsSync(`${testDir}/sub`)).toBe(true);
  });
});
