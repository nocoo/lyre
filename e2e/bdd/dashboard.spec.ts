import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads dashboard page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const dashboardLink = page
      .getByRole("link", { name: "Dashboard" })
      .first();
    await expect(dashboardLink).toBeVisible({ timeout: 10_000 });
  });

  test("sidebar navigation works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "All Recordings" }).click();
    await expect(page).toHaveURL(/\/recordings/);
    await expect(
      page.getByRole("heading", { name: "Recordings", exact: true, level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/");
  });
});
