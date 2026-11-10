import { isNavItemActive, isRecordingsPath } from "@lyre/api/lib/sidebar-nav";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Button,
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
import { Bot, HardDrive, Key, LayoutDashboard, LogOut, Mic, Settings } from "lucide-react";
import { useNavigate } from "react-router";
import { GlobalSearch } from "@/components/global-search";
import { useSession } from "@/hooks/use-me";
import { ACCESS_LOGOUT_URL } from "@/lib/access";
import { useLocationPathname } from "@/lib/router-compat";
import { cn, getAvatarColor } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { FolderSidebar, FolderSidebarCollapsed } from "./folder-sidebar";

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

function SidebarToggleAction({ onToggle }: { onToggle?: () => void }) {
	return (
		<SidebarToggle
			onClick={
				onToggle
					? (event) => {
							event.preventDefault();
							onToggle();
						}
					: undefined
			}
		/>
	);
}

function AppSidebarNav() {
	const pathname = useLocationPathname();
	const navigate = useNavigate();
	const { collapsed } = useSidebar();
	const isRecordingsPage = isRecordingsPath(pathname);

	if (collapsed) {
		return (
			<>
				<Tooltip delayDuration={0}>
					<TooltipTrigger asChild>
						<SidebarIconItem
							active={pathname === "/"}
							aria-label="Dashboard"
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
			</>
		);
	}

	return (
		<>
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
		</>
	);
}

function AppSidebarFooter() {
	const { data: session } = useSession();
	const { collapsed } = useSidebar();
	const userName = session?.user?.name ?? "User";
	const userImage = session?.user?.image;
	const userInitial = userName[0] ?? "?";

	const avatar = (
		<Avatar className="h-9 w-9 shrink-0">
			{userImage && <AvatarImage src={userImage} alt={userName} />}
			<AvatarFallback className={cn("text-basalt-sm text-white", getAvatarColor(userName))}>
				{userInitial}
			</AvatarFallback>
		</Avatar>
	);

	if (collapsed) {
		return (
			<Tooltip delayDuration={0}>
				<TooltipTrigger asChild>
					<button type="button" onClick={signOut} className="cursor-pointer" aria-label="Sign out">
						{avatar}
					</button>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={8}>
					{userName} — Sign out
				</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<SidebarUser
			name={userName}
			email={session?.user?.email ?? ""}
			avatar={avatar}
			action={
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
							<LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">Sign out</TooltipContent>
				</Tooltip>
			}
		/>
	);
}

function AppSidebarChrome({ onToggle }: { onToggle?: () => void }) {
	return (
		<Sidebar>
			<SidebarHeader>
				<SidebarBrand
					logo={
						<Link
							href="/"
							aria-label="Home"
							className="flex items-center justify-center no-underline"
						>
							<img
								src="/logo-24.png"
								alt=""
								width={24}
								height={24}
								className="size-basalt-sidebar-brand-slot object-contain"
							/>
						</Link>
					}
					name="lyre"
					version={`v${APP_VERSION}`}
					action={<SidebarToggleAction onToggle={onToggle} />}
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
	onToggle,
}: {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onToggle?: () => void;
}) {
	return (
		<SidebarProvider collapsed={collapsed} onCollapsedChange={onCollapsedChange}>
			<AppSidebarChrome onToggle={onToggle} />
		</SidebarProvider>
	);
}
