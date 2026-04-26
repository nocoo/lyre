"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { usePathname } from "next/navigation";
import { Menu, Rocket } from "lucide-react";
import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { BreadcrumbsProvider, useBreadcrumbs } from "./breadcrumbs-context";
import { ThemeToggle } from "./theme-toggle";
import { GitHubLink } from "./github-link";
import { Breadcrumbs } from "./breadcrumbs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
}

/** Scroll threshold (px) before showing the scroll-to-top FAB */
const SCROLL_THRESHOLD = 300;

function AppShellInner({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { items: breadcrumbItems } = useBreadcrumbs();
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Track scroll position on the content container
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      setShowScrollTop(el.scrollTop > SCROLL_THRESHOLD);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Reset scroll position on route change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar */}
      {!isMobile && (
        <Suspense>
          <Sidebar />
        </Suspense>
      )}

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-[260px]">
            <Suspense>
              <Sidebar />
            </Suspense>
          </div>
        </>
      )}

      <main className="flex flex-1 flex-col min-h-screen min-w-0">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Menu
                  className="h-5 w-5"
                  aria-hidden="true"
                  strokeWidth={1.5}
                />
              </button>
            )}
            <Breadcrumbs
              items={[{ label: "Home", href: "/" }, ...breadcrumbItems]}
            />
          </div>
          <div className="flex items-center gap-1">
            <GitHubLink />
            <ThemeToggle />
          </div>
        </header>

        {/* Floating island content area */}
        <div className="flex-1 px-2 pb-2 md:px-3 md:pb-3 relative">
          <div
            ref={scrollRef}
            className="h-full rounded-[16px] md:rounded-[20px] bg-card p-3 md:p-5 overflow-y-auto"
          >
            {children}
          </div>

          {/* Scroll-to-top FAB */}
          <button
            type="button"
            onClick={scrollToTop}
            aria-label="Scroll to top"
            className={cn(
              "absolute bottom-6 right-6 z-30 flex h-10 w-10 items-center justify-center rounded-full",
              "bg-primary text-primary-foreground shadow-lg",
              "transition-all duration-300 ease-out",
              "hover:bg-primary/90 hover:scale-110 active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              showScrollTop
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4 pointer-events-none",
            )}
          >
            <Rocket className="h-4.5 w-4.5" strokeWidth={1.5} />
          </button>
        </div>
      </main>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <BreadcrumbsProvider>
        <AppShellInner>{children}</AppShellInner>
      </BreadcrumbsProvider>
    </SidebarProvider>
  );
}
