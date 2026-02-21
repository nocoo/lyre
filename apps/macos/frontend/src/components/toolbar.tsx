"use client";

import Image from "next/image";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

type Page = "recordings" | "settings";

interface ToolbarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export function Toolbar({ activePage, onNavigate }: ToolbarProps) {
  return (
    <header
      data-tauri-drag-region
      className="fixed top-0 right-0 left-0 z-50 border-b bg-background"
    >
      {/* Row 1: traffic light zone (drag region only) */}
      <div data-tauri-drag-region className="h-[38px]" />
      {/* Row 2: title + nav buttons */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 pb-3"
      >
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo-24.png"
            alt="Lyre"
            width={20}
            height={20}
            className=""
          />
          <h1 className="text-base font-semibold">Lyre</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={activePage === "settings" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => onNavigate("settings")}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
