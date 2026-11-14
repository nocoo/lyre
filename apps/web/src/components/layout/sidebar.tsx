import { isNavItemActive, isRecordingsPath } from "@lyre/api/lib/sidebar-nav";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Link,
	Sidebar,
	SidebarBrand,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarProvider,
	SidebarSearch,
	SidebarToggle,
	SidebarUser,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import { useSidebar } from "@nocoo/basalt/components/sidebar";
import { Bot, HardDrive, Key, LayoutDashboard, Mic, Settings } from "lucide-react";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { GlobalSearch } from "@/components/global-search";
import { useSession } from "@/hooks/use-me";
import { ACCESS_LOGOUT_URL } from "@/lib/access";
import { useLocationPathname } from "@/lib/router-compat";
import { cn, getAvatarColor } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { FolderSidebar, FolderSidebarCollapsed } from "./folder-sidebar";
import { useMobileNavClose } from "./mobile-nav-close";

const settingsItems = [
	{ href: "/settings", label: "General", icon: Settings, exact: true },
	{ href: "/settings/ai", label: "AI Settings", icon: Bot, exact: false },
	{ href: "/settings/tokens", label: "Device Tokens", icon: Key, exact: false },
	{ href: "/settings/storage", label: "Storage", icon: HardDrive, exact: false },
];

function openSearch() {
	document.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "k",
			metaKey: true,
			bubbles: true,
		}),
	);
}

function AppSidebarNav() {
	const pathname = useLocationPathname();
	const navigate = useNavigate();
	const closeMobileNav = useMobileNavClose();
	const { collapsed } = useSidebar();
	const isRecordingsPage = isRecordingsPath(pathname);

	const go = useCallback(
		(to: string) => {
			closeMobileNav?.();
			navigate(to);
		},
		[closeMobileNav, navigate],
	);

	if (collapsed) {
		return (
			<>
				<Tooltip delayDuration={0}>
					<TooltipTrigger asChild>
						<SidebarIconItem
							active={pathname === "/"}
							aria-label="Dashboard"
							onClick={() => go("/")}
						>
							<LayoutDashboard className="h-4 w-4" strokeWidth={1.5} />
						</SidebarIconItem>
					</TooltipTrigger>
					<TooltipContent side="right" sideOffset={8}>
						Dashboard
					</TooltipContent>
				</Tooltip>
				<Tooltip delayDuration={0}>
					<TooltipTrigger asChild>
						<SidebarIconItem
							active={isRecordingsPage}
							aria-label="Recordings"
							onClick={() => go("/recordings")}
						>
							<Mic className="h-4 w-4" strokeWidth={1.5} />
						</SidebarIconItem>
					</TooltipTrigger>
					<TooltipContent side="right" sideOffset={8}>
						Recordings
					</TooltipContent>
				</Tooltip>
				{isRecordingsPage && <FolderSidebarCollapsed />}
				{settingsItems.map((item) => {
					const isActive = isNavItemActive(item, pathname);
					return (
						<Tooltip key={item.href} delayDuration={0}>
							<TooltipTrigger asChild>
								<SidebarIconItem
									active={isActive}
									aria-label={item.label}
									onClick={() => go(item.href)}
								>
									<item.icon className="h-4 w-4" strokeWidth={1.5} />
								</SidebarIconItem>
							</TooltipTrigger>
							<TooltipContent side="right" sideOffset={8}>
								{item.label}
							</TooltipContent>
						</Tooltip>
					);
				})}
			</>
		);
	}

	return (
		<>
			<SidebarGroup label="General">
				<SidebarItem active={pathname === "/"} onClick={() => go("/")}>
					<LayoutDashboard className="h-4 w-4 shrink-0" strokeWidth={1.5} />
					<span className="flex-1 truncate text-left">Dashboard</span>
				</SidebarItem>
			</SidebarGroup>
			<SidebarGroup label="Recordings">
				<FolderSidebar />
			</SidebarGroup>
			<SidebarGroup label="Settings">
				{settingsItems.map((item) => (
					<SidebarItem
						key={item.href}
						active={isNavItemActive(item, pathname)}
						onClick={() => go(item.href)}
					>
						<item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
						<span className="flex-1 truncate text-left">{item.label}</span>
					</SidebarItem>
				))}
			</SidebarGroup>
		</>
	);
}

function AppSidebarFooter() {
	const { data: session } = useSession();
	const userName = session?.user?.name ?? "User";
	const userImage = session?.user?.image;
	const userInitial = userName[0] ?? "?";

	const avatar = (
		<Avatar>
			{userImage && <AvatarImage src={userImage} alt={userName} />}
			<AvatarFallback className={cn("text-basalt-sm text-white", getAvatarColor(userName))}>
				{userInitial}
			</AvatarFallback>
		</Avatar>
	);

	return (
		<SidebarUser
			name={userName}
			email={session?.user?.email ?? ""}
			avatar={avatar}
			signOutHref={ACCESS_LOGOUT_URL}
		/>
	);
}

function AppSidebarChrome({ dismissDrawer }: { dismissDrawer?: () => void }) {
	const closeMobileNav = useMobileNavClose();

	return (
		<Sidebar resizable={!dismissDrawer}>
			<SidebarHeader>
				<SidebarBrand
					logo={
						<Link
							href="/"
							aria-label="Home"
							className="flex items-center justify-center no-underline"
							onClick={() => closeMobileNav?.()}
						>
							<img src="/logo-80.png" alt="" width={24} height={24} />
						</Link>
					}
					name="lyre"
					version={`v${APP_VERSION}`}
					action={
						dismissDrawer ? (
							<SidebarToggle mode="dismiss" onDismiss={dismissDrawer} />
						) : (
							<SidebarToggle />
						)
					}
				/>
			</SidebarHeader>
			<SidebarNav>
				<SidebarSearch onClick={openSearch} shortcut="⌘K">
					Search
				</SidebarSearch>
				<AppSidebarNav />
			</SidebarNav>
			<SidebarFooter>
				<AppSidebarFooter />
			</SidebarFooter>
			<GlobalSearch />
		</Sidebar>
	);
}

export function AppSidebar({
	collapsed,
	onCollapsedChange,
	dismissDrawer,
}: {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	/** Mobile drawer: close the sheet instead of collapsing the rail. */
	dismissDrawer?: () => void;
}) {
	if (dismissDrawer) {
		return <AppSidebarChrome dismissDrawer={dismissDrawer} />;
	}

	return (
		<SidebarProvider collapsed={collapsed} onCollapsedChange={onCollapsedChange}>
			<AppSidebarChrome />
		</SidebarProvider>
	);
}
