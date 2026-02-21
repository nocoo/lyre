"use client";

import { useState } from "react";
import { Toolbar } from "@/components/toolbar";
import { SettingsPage } from "@/components/settings-page";
import { RecordingsPage } from "@/components/recordings-page";
import { AboutPage } from "@/components/about-page";
import { CleanupPage } from "@/components/cleanup-page";
import { Toaster } from "@/components/ui/sonner";

type Page = "recordings" | "settings" | "about" | "cleanup";

export default function Home() {
  const [page, setPage] = useState<Page>("recordings");

  if (page === "settings") {
    return (
      <>
        <SettingsPage onBack={() => setPage("recordings")} />
        <Toaster position="bottom-center" duration={3000} />
      </>
    );
  }

  if (page === "about") {
    return (
      <>
        <AboutPage onBack={() => setPage("recordings")} />
        <Toaster position="bottom-center" duration={3000} />
      </>
    );
  }

  if (page === "cleanup") {
    return (
      <>
        <CleanupPage onBack={() => setPage("recordings")} />
        <Toaster position="bottom-center" duration={3000} />
      </>
    );
  }

  return (
    <main
      className="flex h-screen flex-col pt-[74px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Toolbar
        activePage={page}
        onNavigate={setPage}
      />
      <RecordingsPage onNavigateCleanup={() => setPage("cleanup")} />
      <Toaster position="bottom-center" duration={3000} />
    </main>
  );
}
