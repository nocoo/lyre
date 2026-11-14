import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
	for (const width of [1024, 1440]) {
		test(`sidebar identity stays aligned at ${width}px in ${theme} mode`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await page.goto("/");
			await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
			const sidebar = page.locator("[data-basalt-sidebar]");
			const user = sidebar.locator('[data-slot="sidebar-user"]');
			const avatar = user.locator('[class~="h-basalt-9"]');
			const brand = sidebar.locator('[data-slot="sidebar-brand-copy"]');
			const logo = sidebar.locator('[data-slot="sidebar-brand-logo"] img');
			await expect(sidebar).toHaveCSS("width", "260px");
			await expect(avatar).toHaveCSS("width", "36px");
			await expect(avatar).toHaveCSS("height", "36px");
			await expect(user.locator("p").nth(1)).toHaveCSS("line-height", "16px");
			await expect(user.locator("p").nth(1)).not.toBeEmpty();
			await expect(brand).toBeVisible();
			await expect(brand).toContainText("lyre");
			await expect(brand).toContainText(/v\d+\.\d+\.\d+/);
			await expect(logo).toHaveCSS("width", "24px");
			await expect(logo).toHaveCSS("height", "24px");
			await expect(user.getByRole("link", { name: "Sign out" })).toHaveAttribute(
				"href",
				"https://nocoo.cloudflareaccess.com/cdn-cgi/access/logout",
			);
			const expanded = await avatar.boundingBox();
			const expandedLogo = await logo.boundingBox();
			expect(expanded).not.toBeNull();
			expect(expandedLogo).not.toBeNull();
			await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
			await page.mouse.move(width - 1, 0);
			await expect(sidebar).toHaveAttribute("data-collapsed", "");
			await expect(sidebar).toHaveCSS("width", "68px");
			await expect(avatar).toHaveCSS("width", "36px");
			await expect(avatar).toHaveCSS("height", "36px");
			await expect(brand).toBeHidden();
			await expect(user.getByRole("link", { name: "Sign out" })).toHaveCount(0);
			const collapsed = await avatar.boundingBox();
			const collapsedLogo = await logo.boundingBox();
			expect(collapsed?.y).toBe(expanded?.y);
			expect(collapsedLogo?.x).toBe(expandedLogo?.x);
			expect(collapsedLogo?.y).toBe(expandedLogo?.y);
			await testInfo.attach("sidebar-measurements", {
				body: JSON.stringify({ expanded, collapsed, expandedLogo, collapsedLogo }),
				contentType: "application/json",
			});
			await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
			await expect(sidebar).toHaveCSS("width", "260px");
			await expect(brand).toBeVisible();
			await sidebar.getByRole("button", { name: "General", exact: true }).last().click();
			await expect(page).toHaveURL(/\/settings$/);
			await expect(user.locator("p").nth(1)).not.toBeEmpty();
		});
	}

	for (const width of [390, 640, 767]) {
		test(`mobile drawer geometry and keyboard at ${width}px in ${theme} mode`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 844 });
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await page.goto("/");
			await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
			const menu = page.getByRole("button", { name: "Open navigation", includeHidden: true });
			const drawer = page.locator('[data-slot="sidebar-drawer"]');
			await expect(menu).toHaveAttribute("aria-expanded", "false");
			await menu.click();
			await expect(drawer).toBeVisible();
			await expect(menu).toHaveAttribute("aria-expanded", "true");
			await expect(menu).toHaveAttribute("aria-controls", /.+/);
			expect(await menu.getAttribute("aria-controls")).toBe(await drawer.getAttribute("id"));
			await expect(drawer).toHaveAccessibleName("Navigation");
			await expect(drawer).toHaveAccessibleDescription("Application navigation links and actions.");
			await expect(drawer).toHaveCSS("width", "320px");
			await expect(drawer).toHaveCSS("padding", "0px");
			const sidebar = drawer.locator("[data-basalt-sidebar]");
			await expect(sidebar).toHaveCSS("width", "260px");
			await expect(sidebar).not.toHaveAttribute("data-collapsed", "");
			await expect(page.locator("[data-basalt-sidebar]")).toHaveCount(1);
			const avatar = sidebar.locator('[data-slot="sidebar-user"] [class~="h-basalt-9"]');
			await expect(avatar).toHaveCSS("width", "36px");
			await expect(avatar).toHaveCSS("height", "36px");
			await expect(sidebar.locator('[data-slot="sidebar-user"] p').nth(1)).toHaveCSS(
				"line-height",
				"16px",
			);
			await expect(sidebar.locator('[data-slot="sidebar-brand-copy"]')).toBeVisible();
			const dismiss = sidebar.getByRole("button", { name: "Close navigation" });
			await expect(dismiss).toHaveAttribute("data-slot", "sidebar-toggle");
			await dismiss.focus();
			await page.keyboard.press("Tab");
			expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(
				true,
			);
			await dismiss.focus();
			await testInfo.attach("drawer-measurements", {
				body: JSON.stringify({
					outer: await drawer.boundingBox(),
					inner: await sidebar.boundingBox(),
					avatar: await avatar.boundingBox(),
				}),
				contentType: "application/json",
			});
			await page.keyboard.press("Escape");
			await expect(drawer).not.toBeVisible();
			await expect(menu).toBeFocused();
			await expect(menu).toHaveAttribute("aria-expanded", "false");
			await menu.click();
			await dismiss.click();
			await expect(drawer).not.toBeVisible();
			await expect(menu).toBeFocused();
			await menu.click();
			await sidebar.getByRole("button", { name: "All Recordings", exact: true }).click();
			await expect(page).toHaveURL(/\/recordings$/);
			await expect(drawer).not.toBeVisible();
			await expect(menu).toBeFocused();
			await menu.click();
			await expect(
				sidebar.getByRole("button", { name: "All Recordings", exact: true }),
			).toHaveAttribute("data-hover-selected", "true");
			await page.keyboard.press("Escape");
			await expect(menu).toBeFocused();
		});
	}
}
