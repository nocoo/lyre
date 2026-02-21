import { describe, expect, test } from "bun:test";
import { hashToken } from "@/lib/api-auth";

describe("hashToken", () => {
  test("returns a 64-char hex string", () => {
    const hash = hashToken("some-token");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("produces deterministic output", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  test("produces different output for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});
