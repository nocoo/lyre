import { expect, test } from "@playwright/test";

test.describe("Settings", () => {
	test("general settings page renders", async ({ page }) => {
		await page.goto("/settings");

		await expect(
			page.locator("[data-basalt-surface-root]").getByRole("heading", { name: "General" }),
		).toBeVisible();
	});

	test("AI settings page renders", async ({ page }) => {
		await page.goto("/settings/ai");

		await expect(
			page
				.locator("[data-basalt-surface-root]")
				.getByRole("heading", { name: "AI & ASR Settings" }),
		).toBeVisible();
		await expect(page.getByText("Configure LLM provider").first()).toBeVisible();
	});

	test("storage settings page renders", async ({ page }) => {
		await page.goto("/settings/storage");

		await expect(
			page.locator("[data-basalt-surface-root]").getByRole("heading", { name: "Storage" }),
		).toBeVisible();
	});

	test("device tokens page renders", async ({ page }) => {
		await page.goto("/settings/tokens");

		await expect(
			page.locator("[data-basalt-surface-root]").getByRole("heading", { name: "Device Tokens" }),
		).toBeVisible();
	});
});
