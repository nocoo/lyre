"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Mic,
  Settings,
  PanelLeft,
  LogOut,
  Search,
  ChevronDown,
} from "lucide-react";
import { cn, getAvatarColor } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GlobalSearch } from "@/components/global-search";
import { useSidebar } from "./sidebar-context";
import { FolderSidebar, FolderSidebarCollapsed } from "./folder-sidebar";

const staticNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const { data: session } = useSession();

  const userName = session?.user?.name ?? "User";
  const userImage = session?.user?.image;
  const userInitial = userName[0] ?? "?";

  const isRecordingsPage = pathname.startsWith("/recordings");
  const [recordingsOpen, setRecordingsOpen] = useState(isRecordingsPage);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col bg-background transition-all duration-300 ease-in-out overflow-hidden",
          collapsed ? "w-[68px]" : "w-[260px]",
        )}
      >
        {collapsed ? (
          /* ── Collapsed (icon-only) view ── */
          <div className="flex h-screen w-[68px] flex-col items-center">
            {/* Logo */}
            <div className="flex h-14 w-full items-center justify-start pl-6 pr-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-24.png"
                alt="Lyre"
                width={24}
                height={24}
                className="shrink-0"
              />
            </div>

            {/* Expand toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggle}
                  aria-label="Expand sidebar"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-1"
                >
                  <PanelLeft
                    className="h-4 w-4"
                    aria-hidden="true"
                    strokeWidth={1.5}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>

            {/* Search icon */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    document.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "k",
                        metaKey: true,
                        bubbles: true,
                      }),
                    );
                  }}
                  aria-label="Search (⌘K)"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-2"
                >
                  <Search
                    className="h-4 w-4"
                    aria-hidden="true"
                    strokeWidth={1.5}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Search (⌘K)
              </TooltipContent>
            </Tooltip>

            {/* Navigation */}
            <nav className="flex flex-col items-center gap-1 pt-1">
              {/* Dashboard */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/"
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      pathname === "/"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <LayoutDashboard className="h-4 w-4" strokeWidth={1.5} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Dashboard
                </TooltipContent>
              </Tooltip>

              {/* Recordings */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/recordings"
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      isRecordingsPage
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Mic className="h-4 w-4" strokeWidth={1.5} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Recordings
                </TooltipContent>
              </Tooltip>

              {/* Settings */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/settings"
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      pathname.startsWith("/settings")
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Settings className="h-4 w-4" strokeWidth={1.5} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
            </nav>

            {/* Folder tree — collapsed (icons only) */}
            {isRecordingsPage && <FolderSidebarCollapsed />}

            {/* Spacer when no folder tree */}
            {!isRecordingsPage && <div className="flex-1" />}

            {/* User avatar + sign out */}
            <div className="py-3 flex justify-center w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="cursor-pointer"
                  >
                    <Avatar className="h-9 w-9">
                      {userImage && (
                        <AvatarImage src={userImage} alt={userName} />
                      )}
                      <AvatarFallback
                        className={cn(
                          "text-xs text-white",
                          getAvatarColor(userName),
                        )}
                      >
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {userName} — Sign out
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : (
          /* ── Expanded view ── */
          <div className="flex h-screen w-[260px] flex-col">
            {/* Header: logo + collapse toggle */}
            <div className="px-3 h-14 flex items-center">
              <div className="flex w-full items-center justify-between px-3">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/logo-24.png"
                    alt="Lyre"
                    width={24}
                    height={24}
                    className="shrink-0"
                  />
                  <span className="text-lg font-bold tracking-tighter">
                    lyre
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                    v{APP_VERSION}
                  </Badge>
                </div>
                <button
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                >
                  <PanelLeft
                    className="h-4 w-4"
                    aria-hidden="true"
                    strokeWidth={1.5}
                  />
                </button>
              </div>
            </div>

            {/* Search button */}
            <div className="px-3 pb-1">
              <button
                onClick={() => {
                  document.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "k",
                      metaKey: true,
                      bubbles: true,
                    }),
                  );
                }}
                className="flex w-full items-center gap-3 rounded-lg bg-secondary px-3 py-1.5 transition-colors hover:bg-accent cursor-pointer"
              >
                <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span className="flex-1 text-left text-sm text-muted-foreground">Search</span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                  <kbd className="pointer-events-none hidden rounded-sm border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
                    ⌘K
                  </kbd>
                </span>
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex flex-col pt-1">
              {/* Dashboard */}
              <div className="flex flex-col gap-0.5 px-3">
                {staticNavItems.map((item) => {
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <item.icon
                        className="h-4 w-4 shrink-0"
                        strokeWidth={1.5}
                      />
                      <span className="flex-1 text-left">{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              {/* Recordings — collapsible group */}
              <Collapsible open={recordingsOpen} onOpenChange={setRecordingsOpen}>
                <div className="px-3 mt-0.5">
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                        isRecordingsPage
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      onClick={(e) => {
                        // If not on recordings page, navigate there first
                        if (!isRecordingsPage) {
                          e.preventDefault();
                          window.location.href = "/recordings";
                        }
                      }}
                    >
                      <Mic className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                      <span className="flex-1 text-left">Recordings</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                          !recordingsOpen && "-rotate-90",
                        )}
                        strokeWidth={1.5}
                      />
                    </button>
                  </CollapsibleTrigger>
                </div>
                <div
                  className="grid overflow-hidden"
                  style={{
                    gridTemplateRows: recordingsOpen ? "1fr" : "0fr",
                    transition: "grid-template-rows 200ms ease-out",
                  }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="pt-0.5">
                      <FolderSidebar />
                    </div>
                  </div>
                </div>
              </Collapsible>
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* User info + sign out */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  {userImage && (
                    <AvatarImage src={userImage} alt={userName} />
                  )}
                  <AvatarFallback
                    className={cn(
                      "text-xs text-white",
                      getAvatarColor(userName),
                    )}
                  >
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {userName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {session?.user?.email ?? ""}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => signOut({ callbackUrl: "/login" })}
                      aria-label="Sign out"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                    >
                      <LogOut
                        className="h-4 w-4"
                        aria-hidden="true"
                        strokeWidth={1.5}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Sign out</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Global search dialog (renders the CommandDialog) */}
      <GlobalSearch />
    </TooltipProvider>
  );
}
