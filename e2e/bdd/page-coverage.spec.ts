import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/", name: "Dashboard" },
  { path: "/recordings", name: "Recordings" },
  { path: "/settings", name: "Settings General" },
  { path: "/settings/ai", name: "Settings AI" },
  { path: "/settings/storage", name: "Settings Storage" },
  { path: "/settings/tokens", name: "Settings Tokens" },
];

test.describe("Page coverage", () => {
  for (const { path, name } of PAGES) {
    test(`${name} (${path}) loads without error`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(path);
      await page.waitForLoadState("networkidle");

      expect(errors).toHaveLength(0);
    });
  }
});
