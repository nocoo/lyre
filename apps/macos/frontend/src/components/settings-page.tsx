"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Check, Wifi, WifiOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getConfig, saveConfig, testConnection } from "@/lib/commands";

interface SettingsPageProps {
  onBack: () => void;
}

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

const SERVER_PRESETS = [
  { label: "Production", url: "https://lyre.hexly.ai" },
  { label: "Development", url: "https://lyre.dev.hexly.ai" },
] as const;

function resolvePreset(url: string): string {
  const preset = SERVER_PRESETS.find((p) => p.url === url);
  return preset ? preset.url : "custom";
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("custom");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then((config) => {
        setServerUrl(config.server_url);
        setSelectedPreset(resolvePreset(config.server_url));
        setToken(config.token);
      })
      .catch(() => toast.error("Failed to load config"))
      .finally(() => setLoading(false));
  }, []);

  const handlePresetChange = useCallback((value: string) => {
    setSelectedPreset(value);
    if (value !== "custom") {
      setServerUrl(value);
    }
    setConnectionStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveConfig(serverUrl.trim(), token.trim());
      toast.success("Settings saved");
      onBack();
    } catch (err) {
      console.error("Failed to save config:", err);
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [serverUrl, token, onBack]);

  const handleTest = useCallback(async () => {
    setConnectionStatus("testing");
    try {
      await testConnection(serverUrl.trim(), token.trim());
      setConnectionStatus("connected");
      toast.success("Connected successfully");
    } catch (err) {
      setConnectionStatus("error");
      toast.error(String(err));
    }
  }, [serverUrl, token]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const canTest = serverUrl.trim().length > 0 && token.trim().length > 0;
  const canSave = canTest && connectionStatus === "connected";

  return (
    <div
      className="flex h-screen flex-col pt-[74px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Settings header with back button */}
      <header
        data-tauri-drag-region
        className="fixed top-0 right-0 left-0 z-50 border-b bg-background"
      >
        <div data-tauri-drag-region className="h-[38px]" />
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 px-4 pb-3"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
      </header>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          {/* Server Connection section */}
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Server Connection
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Connect to your Lyre web app. Get a device token from{" "}
              <strong className="text-foreground">
                Settings &gt; Device Tokens
              </strong>{" "}
              in the web UI.
            </p>

            <div className="space-y-1.5">
              <Label>Server URL</Label>
              <div className="flex flex-wrap gap-1.5">
                {SERVER_PRESETS.map((preset) => (
                  <Button
                    key={preset.url}
                    variant={
                      selectedPreset === preset.url ? "default" : "outline"
                    }
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handlePresetChange(preset.url)}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  variant={selectedPreset === "custom" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handlePresetChange("custom")}
                >
                  Custom
                </Button>
              </div>
              {selectedPreset === "custom" && (
                <Input
                  id="server-url"
                  type="url"
                  value={serverUrl}
                  onChange={(e) => {
                    setServerUrl(e.target.value);
                    setConnectionStatus("idle");
                  }}
                  placeholder="https://lyre.example.com"
                  className="mt-1.5"
                />
              )}
              {selectedPreset !== "custom" && (
                <p className="text-[11px] text-muted-foreground">
                  {serverUrl}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="token">Device Token</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setConnectionStatus("idle");
                }}
                placeholder="lyre_..."
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleTest}
                disabled={!canTest || connectionStatus === "testing"}
              >
                {connectionStatus === "testing" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : connectionStatus === "connected" ? (
                  <Check className="h-3 w-3" />
                ) : connectionStatus === "error" ? (
                  <WifiOff className="h-3 w-3" />
                ) : (
                  <Wifi className="h-3 w-3" />
                )}
                {connectionStatus === "testing"
                  ? "Testing..."
                  : connectionStatus === "connected"
                    ? "Connected"
                    : connectionStatus === "error"
                      ? "Failed"
                      : "Test Connection"}
              </Button>
            </div>
          </section>
        </div>
      </div>

      {/* Save button — sticky bottom */}
      <div className="border-t px-4 py-3">
        <Button
          onClick={handleSave}
          disabled={saving || !canSave}
          size="sm"
          className="w-full"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
