import { isNavItemActive, isRecordingsPath } from "@lyre/api/lib/sidebar-nav";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Button,
	Link,
	Sidebar,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarSearch,
	SidebarUser,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import {
	Bot,
	HardDrive,
	Key,
	LayoutDashboard,
	LogOut,
	Mic,
	PanelLeft,
	Search,
	Settings,
} from "lucide-react";
import { useNavigate } from "react-router";
import { GlobalSearch } from "@/components/global-search";
import { useSession } from "@/hooks/use-me";
import { ACCESS_LOGOUT_URL } from "@/lib/access";
import { useLocationPathname } from "@/lib/router-compat";
import { cn, getAvatarColor } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { FolderSidebar, FolderSidebarCollapsed } from "./folder-sidebar";

const SIDEBAR_MARK_SLOT_CLASS = "flex w-full items-center";

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

function signOut() {
	window.location.href = ACCESS_LOGOUT_URL;
}

export function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
	const pathname = useLocationPathname();
	const navigate = useNavigate();
	const { data: session } = useSession();
	const userName = session?.user?.name ?? "User";
	const userImage = session?.user?.image;
	const userInitial = userName[0] ?? "?";
	const isRecordingsPage = isRecordingsPath(pathname);

	const avatar = (
		<Avatar className="h-9 w-9 shrink-0">
			{userImage && <AvatarImage src={userImage} alt={userName} />}
			<AvatarFallback className={cn("text-basalt-sm text-white", getAvatarColor(userName))}>
				{userInitial}
			</AvatarFallback>
		</Avatar>
	);

	return (
		<Sidebar collapsed={collapsed}>
			<SidebarHeader>
				<div
					className={cn(
						SIDEBAR_MARK_SLOT_CLASS,
						collapsed ? "justify-center" : "justify-between pl-basalt-layout-sm",
					)}
				>
					<Link
						href="/"
						aria-label="Home"
						className="flex items-center gap-basalt-space-lg text-basalt-foreground no-underline hover:no-underline"
					>
						<img
							src="/logo-24.png"
							alt=""
							width={24}
							height={24}
							className="h-7 w-7 shrink-0 object-contain"
						/>
						{collapsed ? null : (
							<>
								<span className="text-basalt-xl font-semibold text-basalt-foreground">lyre</span>
								<span className="rounded-basalt-md bg-basalt-secondary px-basalt-space-md py-basalt-space-xs text-basalt-sm leading-basalt-tight font-medium text-basalt-muted-foreground">
									v{APP_VERSION}
								</span>
							</>
						)}
					</Link>
					{collapsed ? null : (
						<Button variant="ghost" size="icon" onClick={onToggle} aria-label="Collapse sidebar">
							<PanelLeft aria-hidden="true" />
						</Button>
					)}
				</div>
			</SidebarHeader>
			{collapsed ? (
				<>
					<Button
						variant="ghost"
						size="icon"
						onClick={onToggle}
						aria-label="Expand sidebar"
						className="mb-basalt-space-sm self-center"
					>
						<PanelLeft aria-hidden="true" />
					</Button>
					<Tooltip delayDuration={0}>
						<TooltipTrigger asChild>
							<SidebarIconItem
								className="mb-2 self-center"
								onClick={openSearch}
								aria-label="Search (⌘K)"
							>
								<Search className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
							</SidebarIconItem>
						</TooltipTrigger>
						<TooltipContent side="right" sideOffset={8}>
							Search (⌘K)
						</TooltipContent>
					</Tooltip>
					<SidebarNav className="w-full items-center gap-1 pt-1">
						<Tooltip delayDuration={0}>
							<TooltipTrigger asChild>
								<SidebarIconItem
									active={pathname === "/"}
									aria-label="Dashboard"
									className="self-center"
									onClick={() => navigate("/")}
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
									className="self-center"
									onClick={() => navigate("/recordings")}
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
											className="self-center"
											onClick={() => navigate(item.href)}
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
					</SidebarNav>
					<SidebarFooter>
						<Tooltip delayDuration={0}>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={signOut}
									className="cursor-pointer"
									aria-label="Sign out"
								>
									{avatar}
								</button>
							</TooltipTrigger>
							<TooltipContent side="right" sideOffset={8}>
								{userName} — Sign out
							</TooltipContent>
						</Tooltip>
					</SidebarFooter>
				</>
			) : (
				<>
					<div className="px-basalt-nav-inset">
						<SidebarSearch onClick={openSearch}>Search</SidebarSearch>
					</div>
					<SidebarNav className="pt-1">
						<SidebarGroup label="General">
							<SidebarItem active={pathname === "/"} onClick={() => navigate("/")}>
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
									onClick={() => navigate(item.href)}
								>
									<item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
									<span className="flex-1 truncate text-left">{item.label}</span>
								</SidebarItem>
							))}
						</SidebarGroup>
					</SidebarNav>
					<SidebarFooter>
						<SidebarUser
							name={userName}
							email={session?.user?.email ?? ""}
							avatar={avatar}
							action={
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											onClick={signOut}
											aria-label="Sign out"
										>
											<LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="top">Sign out</TooltipContent>
								</Tooltip>
							}
						/>
					</SidebarFooter>
				</>
			)}
			<GlobalSearch />
		</Sidebar>
	);
}
