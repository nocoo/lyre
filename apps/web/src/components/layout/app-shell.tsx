import { ContentIsland, SidebarDrawer } from "@nocoo/basalt";
import { AppHeader, AppHeaderMenuButton, ProjectLinks } from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { ThemeToggle } from "@nocoo/basalt/components/theme-toggle";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocationPathname } from "@/lib/router-compat";
import { BreadcrumbsProvider, useBreadcrumbs } from "./breadcrumbs-context";
import { MobileNavCloseProvider } from "./mobile-nav-close";
import { ScrollToTop } from "./scroll-to-top";
import { AppSidebar } from "./sidebar";

interface AppShellProps {
	children: React.ReactNode;
}

const SCROLL_THRESHOLD = 300;

const FALLBACK_TITLE: Record<string, string> = {
	"/": "Dashboard",
	"/recordings": "Recordings",
	"/settings": "General",
	"/settings/ai": "AI Settings",
	"/settings/storage": "Storage",
	"/settings/tokens": "Device Tokens",
};

function headerTrail(
	pathname: string,
	items: { label: string; href?: string }[],
): { breadcrumbs?: { href?: string; label: string }[]; title: string } {
	if (pathname === "/") {
		return { title: "Dashboard" };
	}
	const fallback =
		FALLBACK_TITLE[pathname] ?? (pathname.startsWith("/recordings/") ? "Detail" : "Lyre");
	const current = items[items.length - 1];
	const ancestors = [
		{ href: "/", label: "Home" },
		...items.slice(0, -1).map((item) => ({ href: item.href, label: item.label })),
	];
	return {
		breadcrumbs: ancestors,
		title: current?.label ?? fallback,
	};
}

function AppShellInner({ children }: AppShellProps) {
	const isMobile = useIsMobile();
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const navigationTrigger = useRef<HTMLButtonElement>(null);
	const drawerId = useId();
	const { items: breadcrumbItems } = useBreadcrumbs();
	const pathname = useLocationPathname();
	const [showScrollTop, setShowScrollTop] = useState(false);
	const trail = headerTrail(pathname, breadcrumbItems);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers the effect on route change
	useEffect(() => {
		setMobileOpen(false);
	}, [pathname]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers the effect on route change
	useEffect(() => {
		document.getElementById("island-scroll")?.scrollTo({ top: 0 });
		setShowScrollTop(false);
	}, [pathname]);

	const scrollToTop = useCallback(() => {
		document.getElementById("island-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
	}, []);

	const sidebar = <AppSidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />;

	return (
		<BasaltAppShell>
			<AppSkipLink>Skip to main content</AppSkipLink>
			{!isMobile ? (
				sidebar
			) : (
				<SidebarDrawer
					id={drawerId}
					open={mobileOpen}
					onOpenChange={setMobileOpen}
					returnFocusRef={navigationTrigger}
					title="Navigation"
					description="Application navigation links and actions."
				>
					<MobileNavCloseProvider value={() => setMobileOpen(false)}>
						<AppSidebar
							collapsed={false}
							onCollapsedChange={setCollapsed}
							dismissDrawer={() => setMobileOpen(false)}
						/>
					</MobileNavCloseProvider>
				</SidebarDrawer>
			)}
			<AppMain>
				<AppHeader
					leading={
						isMobile ? (
							<AppHeaderMenuButton
								ref={navigationTrigger}
								aria-controls={drawerId}
								aria-expanded={mobileOpen}
								onClick={() => setMobileOpen(true)}
							/>
						) : null
					}
					breadcrumbs={trail.breadcrumbs}
					breadcrumbsLabel="Breadcrumb"
					title={trail.title}
					actions={
						<>
							<ProjectLinks github="nocoo/lyre" hexly="lyre" name="Lyre" />
							<ThemeToggle />
						</>
					}
				/>
				<div className="relative flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
					<ContentIsland
						id="island-scroll"
						onScroll={(event) => {
							setShowScrollTop(event.currentTarget.scrollTop > SCROLL_THRESHOLD);
						}}
					>
						{children}
					</ContentIsland>
					<ScrollToTop visible={showScrollTop} onClick={scrollToTop} />
				</div>
			</AppMain>
		</BasaltAppShell>
	);
}

export function AppShell({ children }: AppShellProps) {
	return (
		<BreadcrumbsProvider>
			<AppShellInner>{children}</AppShellInner>
		</BreadcrumbsProvider>
	);
}
