import { expect, test } from "@playwright/test";

test("mobile sidebar preserves selection and closes after navigation", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	const openNavigation = page.getByRole("button", { name: "Open navigation" });
	await openNavigation.click();
	const navigation = page.getByRole("dialog", { name: "Navigation" });
	await expect(navigation.getByRole("button", { name: "Dashboard", exact: true })).toHaveAttribute(
		"data-hover-selected",
		"true",
	);
	await navigation.getByRole("button", { name: "All Recordings", exact: true }).click();
	await expect(page).toHaveURL(/\/recordings$/);
	await expect(navigation).not.toBeVisible();
	await openNavigation.click();
	await expect(
		navigation.getByRole("button", { name: "All Recordings", exact: true }),
	).toHaveAttribute("data-hover-selected", "true");
	await page.screenshot({ path: testInfo.outputPath("sidebar-mobile.png") });
	await page.keyboard.press("Escape");
	await expect(navigation).not.toBeVisible();
	await expect(openNavigation).toBeFocused();
});
