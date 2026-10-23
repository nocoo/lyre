import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
	test(`sidebar keeps selection separate from hover in ${theme} mode`, async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
		await page.goto("/");
		await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
		await expect(page.locator("html")).toHaveAttribute("data-accent", "orange");

		const dashboard = page.getByRole("button", { name: "Dashboard", exact: true });
		const recordings = page.getByRole("button", { name: "All Recordings", exact: true });
		const nav = page.locator('[data-slot="sidebar-nav"]');
		await expect(dashboard).toHaveAttribute("data-hover-selected", "true");
		await expect(dashboard).toHaveCSS("font-weight", "500");
		const selectedColor = await dashboard.evaluate((element) => {
			const style = getComputedStyle(element);
			const channels = style.getPropertyValue("--basalt-selected");
			const probe = document.createElement("span");
			probe.style.color = `hsl(${channels})`;
			element.append(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		});
		await expect(dashboard).toHaveCSS("background-color", selectedColor);
		await recordings.hover();
		await expect(nav).toHaveAttribute("data-hover-visible", "true");
		await expect(dashboard).toHaveCSS("background-color", selectedColor);
		await expect(recordings).toHaveAttribute("data-hover-selected", "false");
		const hoverColor = await nav.evaluate(
			(element) => getComputedStyle(element, "::before").backgroundColor,
		);
		expect(hoverColor).not.toBe(selectedColor);
		expect(hoverColor).not.toBe("rgba(0, 0, 0, 0)");
		await page.screenshot({ path: testInfo.outputPath("sidebar-hover.png") });
		await page.getByRole("heading", { name: "Dashboard", exact: true }).last().hover();
		await expect(nav).not.toHaveAttribute("data-hover-visible", "true");

		await recordings.click();
		await expect(recordings).toHaveAttribute("data-hover-selected", "true");
		await expect(dashboard).toHaveAttribute("data-hover-selected", "false");
		await page.getByRole("button", { name: "Collapse sidebar" }).click();
		await expect(page.locator("[data-basalt-sidebar]")).toHaveAttribute("data-collapsed", "");
		const collapsedRecordings = page.getByRole("button", { name: "Recordings", exact: true });
		await expect(collapsedRecordings).toHaveAttribute("data-hover-selected", "true");
		await expect(collapsedRecordings).toHaveCSS("background-color", selectedColor);
		await page.screenshot({ path: testInfo.outputPath("sidebar-collapsed.png") });
		await page.getByRole("button", { name: "Expand sidebar" }).click();
		await expect(recordings).toHaveAttribute("data-hover-selected", "true");
	});
}
