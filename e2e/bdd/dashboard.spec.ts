import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("renders section headers and stat cards", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Recordings").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Overview of your audio recordings"),
    ).toBeVisible();

    const statCards = page.locator("[class*='rounded-card']");
    await expect(statCards.first()).toBeVisible({ timeout: 10_000 });
  });

  test("sidebar navigation works", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Recordings" }).first().click();
    await expect(page).toHaveURL(/\/recordings/);
    await expect(
      page.getByRole("heading", { name: "Recordings" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/");
  });
});
