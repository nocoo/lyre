"use client";

import { useState } from "react";
import { Database, Globe, Bell, Save } from "lucide-react";
import { AppShell, ThemeToggle } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface SettingSectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingSection({
  icon,
  title,
  description,
  children,
}: SettingSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-sm">{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [defaultLanguage, setDefaultLanguage] = useState("auto");
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);

  return (
    <AppShell breadcrumbs={[{ label: "Settings" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your preferences and configuration.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Appearance */}
          <SettingSection
            icon={
              <Globe
                className="h-4 w-4 text-muted-foreground"
                strokeWidth={1.5}
              />
            }
            title="Appearance"
            description="Customize the look and feel."
          >
            <SettingRow
              label="Theme"
              description="Switch between light and dark mode."
            >
              <ThemeToggle />
            </SettingRow>
          </SettingSection>

          {/* Transcription */}
          <SettingSection
            icon={
              <Database
                className="h-4 w-4 text-muted-foreground"
                strokeWidth={1.5}
              />
            }
            title="Transcription"
            description="Default transcription settings."
          >
            <SettingRow
              label="Default language"
              description="Language hint for the ASR engine."
            >
              <select
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="auto">Auto-detect</option>
                <option value="zh">Chinese</option>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
              </select>
            </SettingRow>
          </SettingSection>

          {/* Notifications */}
          <SettingSection
            icon={
              <Bell
                className="h-4 w-4 text-muted-foreground"
                strokeWidth={1.5}
              />
            }
            title="Notifications"
            description="Control when you get notified."
          >
            <SettingRow
              label="Transcription complete"
              description="Show a notification when transcription finishes."
            >
              <button
                type="button"
                role="switch"
                aria-checked={notifyOnComplete}
                onClick={() => setNotifyOnComplete((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notifyOnComplete ? "bg-foreground" : "bg-secondary"}`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${notifyOnComplete ? "translate-x-5" : "translate-x-0"}`}
                />
              </button>
            </SettingRow>
          </SettingSection>

          {/* Storage */}
          <SettingSection
            icon={
              <Database
                className="h-4 w-4 text-muted-foreground"
                strokeWidth={1.5}
              />
            }
            title="Storage"
            description="Aliyun OSS configuration."
          >
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Bucket name</Label>
                <Input
                  value="lyre-audio"
                  readOnly
                  className="mt-1"
                  disabled
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs">
                  Connected
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Server-side configuration
                </span>
              </div>
            </div>
          </SettingSection>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button className="gap-2">
            <Save className="h-4 w-4" strokeWidth={1.5} />
            Save changes
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
