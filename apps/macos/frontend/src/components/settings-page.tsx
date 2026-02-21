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

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then((config) => {
        setServerUrl(config.server_url);
        setToken(config.token);
      })
      .catch(() => toast.error("Failed to load config"))
      .finally(() => setLoading(false));
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
      await testConnection();
      setConnectionStatus("connected");
      toast.success("Connected successfully");
    } catch (err) {
      setConnectionStatus("error");
      toast.error(String(err));
    }
    setTimeout(() => setConnectionStatus("idle"), 4000);
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const canSubmit = serverUrl.trim().length > 0 && token.trim().length > 0;

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
              <Label htmlFor="server-url">Server URL</Label>
              <Input
                id="server-url"
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://lyre.example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="token">Device Token</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="lyre_..."
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleTest}
                disabled={!canSubmit || connectionStatus === "testing"}
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
          disabled={saving || !canSubmit}
          size="sm"
          className="w-full"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
