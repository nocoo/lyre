"use client";

import { AppShell } from "@/components/layout";
import { AiSettingsSection } from "@/components/ai-settings";

export default function AiSettingsPage() {
  return (
    <AppShell breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "AI Settings" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">AI Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure LLM provider for AI-powered summaries.
          </p>
        </div>

        <AiSettingsSection />
      </div>
    </AppShell>
  );
}
