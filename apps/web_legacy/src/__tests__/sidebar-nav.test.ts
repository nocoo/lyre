import { describe, expect, test } from "bun:test";
import {
  isNavItemActive,
  isRecordingsPath,
  isSettingsPath,
  isAllRecordingsActive,
  type NavItem,
} from "@lyre/api/lib/sidebar-nav";

/**
 * Tests for sidebar navigation utility functions.
 *
 * These test the exported functions from sidebar-nav.ts directly,
 * covering the exact/prefix route matching logic and page detection helpers.
 */

describe("sidebar navigation", () => {
  describe("isNavItemActive", () => {
    const exactItem: NavItem = { href: "/settings", label: "General", exact: true };
    const prefixItem: NavItem = { href: "/settings/ai", label: "AI Settings", exact: false };

    test("exact match: active on exact path", () => {
      expect(isNavItemActive(exactItem, "/settings")).toBe(true);
    });

    test("exact match: inactive on child path", () => {
      expect(isNavItemActive(exactItem, "/settings/ai")).toBe(false);
    });

    test("exact match: inactive on unrelated path", () => {
      expect(isNavItemActive(exactItem, "/recordings")).toBe(false);
    });

    test("prefix match: active on exact path", () => {
      expect(isNavItemActive(prefixItem, "/settings/ai")).toBe(true);
    });

    test("prefix match: active on nested path", () => {
      expect(isNavItemActive(prefixItem, "/settings/ai/models")).toBe(true);
    });

    test("prefix match: inactive on parent path", () => {
      expect(isNavItemActive(prefixItem, "/settings")).toBe(false);
    });

    test("prefix match: inactive on sibling path", () => {
      expect(isNavItemActive(prefixItem, "/settings/tokens")).toBe(false);
    });
  });

  describe("isRecordingsPath", () => {
    test("true for /recordings and nested paths", () => {
      expect(isRecordingsPath("/recordings")).toBe(true);
      expect(isRecordingsPath("/recordings/123")).toBe(true);
    });

    test("false for non-recordings paths", () => {
      expect(isRecordingsPath("/")).toBe(false);
      expect(isRecordingsPath("/settings")).toBe(false);
    });
  });

  describe("isSettingsPath", () => {
    test("true for /settings and nested paths", () => {
      expect(isSettingsPath("/settings")).toBe(true);
      expect(isSettingsPath("/settings/ai")).toBe(true);
    });

    test("false for non-settings paths", () => {
      expect(isSettingsPath("/")).toBe(false);
      expect(isSettingsPath("/recordings")).toBe(false);
    });
  });

  describe("isAllRecordingsActive", () => {
    test("active on /recordings with no folder param", () => {
      expect(isAllRecordingsActive("/recordings", null)).toBe(true);
    });

    test("active on recording detail with no folder param", () => {
      expect(isAllRecordingsActive("/recordings/123", null)).toBe(true);
    });

    test("inactive when folder param is set", () => {
      expect(isAllRecordingsActive("/recordings", "some-folder")).toBe(false);
    });

    test("inactive on non-recordings page", () => {
      expect(isAllRecordingsActive("/", null)).toBe(false);
      expect(isAllRecordingsActive("/settings", null)).toBe(false);
    });
  });
});
