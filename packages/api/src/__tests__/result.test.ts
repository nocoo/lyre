import { describe, expect, test } from "vitest";
import { rowsAffected } from "../db/drivers/result";

describe("rowsAffected", () => {
  test("reads changes from bun:sqlite/better-sqlite3 shape", () => {
    expect(rowsAffected({ changes: 3, lastInsertRowid: 7 })).toBe(3);
    expect(rowsAffected({ changes: 0 })).toBe(0);
  });

  test("reads meta.changes from D1 shape", () => {
    expect(rowsAffected({ success: true, meta: { changes: 2 } })).toBe(2);
    expect(rowsAffected({ success: true, meta: { changes: 0 } })).toBe(0);
  });

  test("returns 0 for unknown / nullish shapes", () => {
    expect(rowsAffected(null)).toBe(0);
    expect(rowsAffected(undefined)).toBe(0);
    expect(rowsAffected({})).toBe(0);
    expect(rowsAffected({ meta: {} })).toBe(0);
    expect(rowsAffected("oops")).toBe(0);
  });

  test("prefers top-level changes when both shapes overlap", () => {
    expect(rowsAffected({ changes: 9, meta: { changes: 1 } })).toBe(9);
  });
});
