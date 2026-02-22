"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, Save, Plug, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AI_PROVIDERS,
  ALL_PROVIDER_IDS,
  CUSTOM_PROVIDER_INFO,
  type AiProvider,
  type SdkType,
} from "@/services/ai";

interface AiSettings {
  provider: AiProvider | "";
  apiKey: string;
  hasApiKey: boolean;
  model: string;
  autoSummarize: boolean;
  baseURL: string;
  sdkType: SdkType | "";
}

type TestStatus = "idle" | "testing" | "success" | "error";

/** Special value used in the model dropdown to indicate custom input. */
const CUSTOM_MODEL_VALUE = "__custom__";

export function AiSettingsSection() {
  const [settings, setSettings] = useState<AiSettings>({
    provider: "",
    apiKey: "",
    hasApiKey: false,
    model: "",
    autoSummarize: false,
    baseURL: "",
    sdkType: "",
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Load settings on mount
  useEffect(() => {
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then((data: AiSettings) => {
        setSettings(data);
        setApiKeyInput(data.apiKey); // masked key

        // Determine if the saved model is a custom one (not in presets)
        if (data.provider && data.provider !== "custom" && data.model) {
          const info = AI_PROVIDERS[data.provider as Exclude<AiProvider, "custom">];
          if (info && !info.models.includes(data.model)) {
            setIsCustomModel(true);
            setCustomModelInput(data.model);
          }
        } else if (data.provider === "custom" && data.model) {
          setCustomModelInput(data.model);
        }

        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Get provider info for current selection
  const isCustomProvider = settings.provider === "custom";
  const providerInfo =
    settings.provider && !isCustomProvider
      ? AI_PROVIDERS[settings.provider as Exclude<AiProvider, "custom">]
      : null;
  const presetModels = providerInfo?.models ?? [];

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        provider: settings.provider,
        model: settings.model,
        autoSummarize: settings.autoSummarize,
      };
      // Only send apiKey if user actually changed it
      if (apiKeyChanged) {
        body.apiKey = apiKeyInput;
      }
      // Include custom provider fields
      if (isCustomProvider) {
        body.baseURL = settings.baseURL;
        body.sdkType = settings.sdkType;
      }
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setApiKeyInput(data.apiKey);
        setApiKeyChanged(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }, [settings, apiKeyInput, apiKeyChanged, isCustomProvider]);

  const handleTest = useCallback(async () => {
    // Save first if there are pending changes
    if (apiKeyChanged || !settings.hasApiKey) {
      await handleSave();
    }
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/settings/ai/test", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setTestStatus("success");
      } else {
        setTestStatus("error");
        setTestError(data.error || "Connection failed");
      }
    } catch {
      setTestStatus("error");
      setTestError("Network error");
    }
    setTimeout(() => setTestStatus("idle"), 4000);
  }, [apiKeyChanged, settings.hasApiKey, handleSave]);

  /** Handle provider change — reset model to first preset or empty. */
  const handleProviderChange = useCallback((value: string) => {
    const provider = value as AiProvider | "";
    setTestStatus("idle");
    setIsCustomModel(false);
    setCustomModelInput("");

    if (!provider) {
      setSettings((s) => ({ ...s, provider: "", model: "", baseURL: "", sdkType: "" }));
      return;
    }

    if (provider === "custom") {
      setSettings((s) => ({
        ...s,
        provider: "custom",
        model: "",
        sdkType: s.sdkType || "openai",
      }));
      return;
    }

    const info = AI_PROVIDERS[provider as Exclude<AiProvider, "custom">];
    setSettings((s) => ({
      ...s,
      provider,
      model: info?.defaultModel ?? "",
    }));
  }, []);

  /** Handle model dropdown change. */
  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === CUSTOM_MODEL_VALUE) {
        setIsCustomModel(true);
        setSettings((s) => ({ ...s, model: customModelInput }));
      } else {
        setIsCustomModel(false);
        setCustomModelInput("");
        setSettings((s) => ({ ...s, model: value }));
      }
    },
    [customModelInput],
  );

  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          <Bot className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <div>
          <h2 className="text-sm font-medium text-foreground">
            AI Configuration
          </h2>
          <p className="text-xs text-muted-foreground">
            Configure LLM provider for AI-powered summaries.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Provider */}
        <div>
          <Label className="text-sm">Provider</Label>
          <select
            value={settings.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm"
          >
            <option value="">Select a provider...</option>
            {ALL_PROVIDER_IDS.map((id) => {
              const label =
                id === "custom"
                  ? CUSTOM_PROVIDER_INFO.label
                  : AI_PROVIDERS[id].label;
              return (
                <option key={id} value={id}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>

        {/* Model — dropdown with presets + custom option (built-in providers) */}
        {!isCustomProvider && (
          <div>
            <Label className="text-sm">Model</Label>
            {presetModels.length > 0 && !isCustomModel ? (
              <select
                value={
                  presetModels.includes(settings.model)
                    ? settings.model
                    : CUSTOM_MODEL_VALUE
                }
                onChange={(e) => handleModelSelect(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm"
              >
                {presetModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={CUSTOM_MODEL_VALUE}>Custom model...</option>
              </select>
            ) : presetModels.length > 0 && isCustomModel ? (
              <div className="mt-1 flex gap-1">
                <Input
                  value={customModelInput}
                  onChange={(e) => {
                    setCustomModelInput(e.target.value);
                    setSettings((s) => ({ ...s, model: e.target.value }));
                  }}
                  placeholder="Enter model name"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2"
                  onClick={() => {
                    setIsCustomModel(false);
                    setCustomModelInput("");
                    setSettings((s) => ({
                      ...s,
                      model: presetModels[0] ?? "",
                    }));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Input
                value={settings.model}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, model: e.target.value }))
                }
                placeholder={
                  providerInfo?.defaultModel ?? "Select provider first"
                }
                className="mt-1"
              />
            )}
          </div>
        )}

        {/* Model — free text for custom provider */}
        {isCustomProvider && (
          <div>
            <Label className="text-sm">Model</Label>
            <Input
              value={settings.model}
              onChange={(e) =>
                setSettings((s) => ({ ...s, model: e.target.value }))
              }
              placeholder="Enter model name"
              className="mt-1"
            />
          </div>
        )}

        {/* Custom provider: Base URL */}
        {isCustomProvider && (
          <div>
            <Label className="text-sm">Base URL</Label>
            <Input
              value={settings.baseURL}
              onChange={(e) =>
                setSettings((s) => ({ ...s, baseURL: e.target.value }))
              }
              placeholder="https://api.example.com/v1"
              className="mt-1"
            />
          </div>
        )}

        {/* Custom provider: SDK Type */}
        {isCustomProvider && (
          <div>
            <Label className="text-sm">SDK Protocol</Label>
            <select
              value={settings.sdkType}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  sdkType: e.target.value as SdkType | "",
                }))
              }
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
        )}

        {/* API Key */}
        <div className="sm:col-span-2">
          <Label className="text-sm">API Key</Label>
          <Input
            type="password"
            value={apiKeyInput}
            onChange={(e) => {
              setApiKeyInput(e.target.value);
              setApiKeyChanged(true);
            }}
            placeholder="Enter your API key"
            className="mt-1"
          />
        </div>

        {/* Auto-summarize toggle */}
        <div className="flex items-start justify-between gap-4 sm:col-span-2">
          <div className="min-w-0">
            <Label className="text-sm">Auto-summarize</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Automatically generate a summary when transcription completes.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoSummarize}
            onClick={() =>
              setSettings((s) => ({
                ...s,
                autoSummarize: !s.autoSummarize,
              }))
            }
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${settings.autoSummarize ? "bg-foreground" : "bg-secondary"}`}
          >
            <span
              className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${settings.autoSummarize ? "translate-x-5" : "translate-x-0"}`}
            />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          onClick={handleSave}
          disabled={saving || !settings.provider}
          className="gap-2"
          size="sm"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {saved ? "Saved" : "Save"}
        </Button>

        <Button
          variant="outline"
          onClick={handleTest}
          disabled={
            testStatus === "testing" ||
            !settings.provider ||
            (!settings.hasApiKey && !apiKeyChanged)
          }
          className="gap-2"
          size="sm"
        >
          {testStatus === "testing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          Test Connection
        </Button>

        {testStatus === "success" && (
          <Badge variant="success" className="text-xs">
            <Check className="mr-1 h-3 w-3" />
            Connected
          </Badge>
        )}
        {testStatus === "error" && (
          <Badge variant="destructive" className="text-xs">
            <X className="mr-1 h-3 w-3" />
            {testError}
          </Badge>
        )}
      </div>
    </div>
  );
}
