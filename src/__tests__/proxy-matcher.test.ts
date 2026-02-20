import { describe, expect, test } from "bun:test";

/**
 * Test the proxy matcher regex to ensure correct path filtering.
 * The matcher is defined in src/proxy.ts config.matcher.
 */
const MATCHER_REGEX = /^\/(?!_next\/static|_next\/image|favicon\.ico|.*\.png$|.*\.ico$|.*\.svg$|api\/(?!auth)).*$/;

describe("proxy matcher", () => {
  test("matches root path", () => {
    expect(MATCHER_REGEX.test("/")).toBe(true);
  });

  test("matches /login", () => {
    expect(MATCHER_REGEX.test("/login")).toBe(true);
  });

  test("matches /recordings", () => {
    expect(MATCHER_REGEX.test("/recordings")).toBe(true);
  });

  test("matches /settings", () => {
    expect(MATCHER_REGEX.test("/settings")).toBe(true);
  });

  test("matches /api/auth routes (auth needs proxy)", () => {
    expect(MATCHER_REGEX.test("/api/auth/signin")).toBe(true);
    expect(MATCHER_REGEX.test("/api/auth/callback/google")).toBe(true);
  });

  test("excludes /api/live (non-auth API)", () => {
    expect(MATCHER_REGEX.test("/api/live")).toBe(false);
  });

  test("excludes /api/recordings (non-auth API)", () => {
    expect(MATCHER_REGEX.test("/api/recordings")).toBe(false);
  });

  test("excludes static assets", () => {
    expect(MATCHER_REGEX.test("/_next/static/chunk.js")).toBe(false);
    expect(MATCHER_REGEX.test("/_next/image/foo")).toBe(false);
  });

  test("excludes favicon and image files", () => {
    expect(MATCHER_REGEX.test("/favicon.ico")).toBe(false);
    expect(MATCHER_REGEX.test("/logo.png")).toBe(false);
    expect(MATCHER_REGEX.test("/icon.svg")).toBe(false);
  });
});
