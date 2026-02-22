import { describe, expect, test } from "bun:test";

/**
 * Sidebar navigation structure and route matching tests.
 *
 * These tests verify the sidebar's navigation items configuration and
 * the "exact vs prefix" route matching logic used to highlight the
 * active nav item. The `settingsItems` definition mirrors the one in
 * `src/components/layout/sidebar.tsx` — if that changes, update here.
 */

// ── Mirror of sidebar settingsItems config ──

interface NavItem {
  href: string;
  label: string;
  exact: boolean;
}

const settingsItems: NavItem[] = [
  { href: "/settings", label: "General", exact: true },
  { href: "/settings/ai", label: "AI Settings", exact: false },
  { href: "/settings/tokens", label: "Device Tokens", exact: false },
];

// Named references (avoids TS strict array-access issues)
const general = settingsItems[0]!;
const aiSettings = settingsItems[1]!;
const tokens = settingsItems[2]!;

// ── Route matching logic (same as sidebar.tsx) ──

function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

// ── Tests ──

describe("sidebar navigation", () => {
  describe("settingsItems configuration", () => {
    test("has exactly 3 settings items", () => {
      expect(settingsItems).toHaveLength(3);
    });

    test("General is the first item and links to /settings", () => {
      expect(general.label).toBe("General");
      expect(general.href).toBe("/settings");
    });

    test("AI Settings links to /settings/ai", () => {
      expect(aiSettings.label).toBe("AI Settings");
      expect(aiSettings.href).toBe("/settings/ai");
    });

    test("Device Tokens links to /settings/tokens", () => {
      expect(tokens.label).toBe("Device Tokens");
      expect(tokens.href).toBe("/settings/tokens");
    });

    test("all items have unique hrefs", () => {
      const hrefs = settingsItems.map((item) => item.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    test("all items have non-empty labels", () => {
      for (const item of settingsItems) {
        expect(item.label.length).toBeGreaterThan(0);
      }
    });

    test("General uses exact matching, sub-pages use prefix matching", () => {
      expect(general.exact).toBe(true);
      expect(aiSettings.exact).toBe(false);
      expect(tokens.exact).toBe(false);
    });
  });

  describe("route matching logic", () => {
    describe("General (/settings, exact)", () => {
      test("active on exact /settings path", () => {
        expect(isNavItemActive(general, "/settings")).toBe(true);
      });

      test("inactive on /settings/ai (exact match prevents false positive)", () => {
        expect(isNavItemActive(general, "/settings/ai")).toBe(false);
      });

      test("inactive on /settings/tokens", () => {
        expect(isNavItemActive(general, "/settings/tokens")).toBe(false);
      });

      test("inactive on unrelated paths", () => {
        expect(isNavItemActive(general, "/")).toBe(false);
        expect(isNavItemActive(general, "/recordings")).toBe(false);
      });
    });

    describe("AI Settings (/settings/ai, prefix)", () => {
      test("active on /settings/ai", () => {
        expect(isNavItemActive(aiSettings, "/settings/ai")).toBe(true);
      });

      test("active on nested paths under /settings/ai", () => {
        expect(isNavItemActive(aiSettings, "/settings/ai/test")).toBe(true);
        expect(isNavItemActive(aiSettings, "/settings/ai/models")).toBe(true);
      });

      test("inactive on /settings (parent)", () => {
        expect(isNavItemActive(aiSettings, "/settings")).toBe(false);
      });

      test("inactive on /settings/tokens (sibling)", () => {
        expect(isNavItemActive(aiSettings, "/settings/tokens")).toBe(false);
      });
    });

    describe("Device Tokens (/settings/tokens, prefix)", () => {
      test("active on /settings/tokens", () => {
        expect(isNavItemActive(tokens, "/settings/tokens")).toBe(true);
      });

      test("active on nested paths under /settings/tokens", () => {
        expect(isNavItemActive(tokens, "/settings/tokens/new")).toBe(true);
      });

      test("inactive on /settings (parent)", () => {
        expect(isNavItemActive(tokens, "/settings")).toBe(false);
      });

      test("inactive on /settings/ai (sibling)", () => {
        expect(isNavItemActive(tokens, "/settings/ai")).toBe(false);
      });
    });

    describe("mutual exclusivity on settings paths", () => {
      test("only General is active on /settings", () => {
        const active = settingsItems.filter((item) =>
          isNavItemActive(item, "/settings"),
        );
        expect(active).toHaveLength(1);
        expect(active[0]!.label).toBe("General");
      });

      test("only AI Settings is active on /settings/ai", () => {
        const active = settingsItems.filter((item) =>
          isNavItemActive(item, "/settings/ai"),
        );
        expect(active).toHaveLength(1);
        expect(active[0]!.label).toBe("AI Settings");
      });

      test("only Device Tokens is active on /settings/tokens", () => {
        const active = settingsItems.filter((item) =>
          isNavItemActive(item, "/settings/tokens"),
        );
        expect(active).toHaveLength(1);
        expect(active[0]!.label).toBe("Device Tokens");
      });

      test("no settings item is active on non-settings paths", () => {
        const paths = ["/", "/recordings", "/recordings/123", "/login"];
        for (const path of paths) {
          const active = settingsItems.filter((item) =>
            isNavItemActive(item, path),
          );
          expect(active).toHaveLength(0);
        }
      });
    });
  });

  describe("top-level page detection", () => {
    // Mirrors the logic in sidebar.tsx
    function isRecordingsPage(pathname: string): boolean {
      return pathname.startsWith("/recordings");
    }

    function isSettingsPage(pathname: string): boolean {
      return pathname.startsWith("/settings");
    }

    test("recordings page detection", () => {
      expect(isRecordingsPage("/recordings")).toBe(true);
      expect(isRecordingsPage("/recordings/123")).toBe(true);
      expect(isRecordingsPage("/")).toBe(false);
      expect(isRecordingsPage("/settings")).toBe(false);
    });

    test("settings page detection", () => {
      expect(isSettingsPage("/settings")).toBe(true);
      expect(isSettingsPage("/settings/ai")).toBe(true);
      expect(isSettingsPage("/settings/tokens")).toBe(true);
      expect(isSettingsPage("/")).toBe(false);
      expect(isSettingsPage("/recordings")).toBe(false);
    });
  });

  describe("folder sidebar 'All Recordings' highlight", () => {
    // Mirrors the logic in folder-sidebar.tsx
    function isAllRecordingsActive(
      pathname: string,
      folderParam: string | null,
    ): boolean {
      return pathname.startsWith("/recordings") && folderParam === null;
    }

    test("active on /recordings with no folder param", () => {
      expect(isAllRecordingsActive("/recordings", null)).toBe(true);
    });

    test("inactive on /recordings when folder param is set", () => {
      expect(isAllRecordingsActive("/recordings", "some-folder")).toBe(false);
    });

    test("inactive on dashboard even when folder param is null", () => {
      expect(isAllRecordingsActive("/", null)).toBe(false);
    });

    test("inactive on settings page", () => {
      expect(isAllRecordingsActive("/settings", null)).toBe(false);
    });

    test("active on recording detail page with no folder param", () => {
      expect(isAllRecordingsActive("/recordings/123", null)).toBe(true);
    });
  });
});
