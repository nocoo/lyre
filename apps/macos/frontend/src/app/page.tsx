"use client";

import { useState } from "react";
import { Toolbar } from "@/components/toolbar";
import { SettingsPage } from "@/components/settings-page";
import { RecordingsPage } from "@/components/recordings-page";
import { AboutPage } from "@/components/about-page";
import { CleanupPage } from "@/components/cleanup-page";
import { UploadPage } from "@/components/upload-page";
import { Toaster } from "@/components/ui/sonner";
import type { RecordingInfo } from "@/lib/commands";

type Page = "recordings" | "settings" | "about" | "cleanup" | "upload";

export default function Home() {
  const [page, setPage] = useState<Page>("recordings");
  const [uploadTarget, setUploadTarget] = useState<RecordingInfo | null>(null);

  const handleNavigateToUpload = (recording: RecordingInfo) => {
    setUploadTarget(recording);
    setPage("upload");
  };

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

  if (page === "upload" && uploadTarget) {
    return (
      <>
        <UploadPage
          recording={uploadTarget}
          onBack={() => {
            setUploadTarget(null);
            setPage("recordings");
          }}
          onUploaded={() => {
            // Stay on upload page to show completion
          }}
        />
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
        activePage="recordings"
        onNavigate={(p) => setPage(p)}
      />
      <RecordingsPage
        onNavigateCleanup={() => setPage("cleanup")}
        onNavigateUpload={handleNavigateToUpload}
      />
      <Toaster position="bottom-center" duration={3000} />
    </main>
  );
}
