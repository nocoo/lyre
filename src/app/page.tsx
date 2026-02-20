"use client";

import { AppShell } from "@/components/layout";

export default function Home() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Audio recording management and transcription.
      </p>
    </AppShell>
  );
}
