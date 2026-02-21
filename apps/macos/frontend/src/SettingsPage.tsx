import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Config {
  server_url: string;
  token: string;
}

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

export function SettingsPage() {
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<Config>("get_config")
      .then((config) => {
        setServerUrl(config.server_url);
        setToken(config.token);
      })
      .catch((err) => {
        console.error("Failed to load config:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      await invoke("save_config", {
        serverUrl: serverUrl.trim(),
        token: token.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save config:", err);
    } finally {
      setSaving(false);
    }
  }, [serverUrl, token]);

  const handleTest = useCallback(async () => {
    setConnectionStatus("testing");
    setConnectionError("");
    try {
      await invoke("test_connection");
      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("error");
      setConnectionError(String(err));
    }
    setTimeout(() => setConnectionStatus("idle"), 4000);
  }, []);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="content">
      <section className="section">
        <h2>Server Connection</h2>
        <p className="description">
          Connect to your Lyre web app. Get a device token from{" "}
          <strong>Settings &gt; Device Tokens</strong> in the web UI.
        </p>

        <div className="field">
          <label htmlFor="server-url">Server URL</label>
          <input
            id="server-url"
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://lyre.example.com"
          />
        </div>

        <div className="field">
          <label htmlFor="token">Device Token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="lyre_..."
          />
        </div>

        <div className="actions">
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || !serverUrl.trim() || !token.trim()}
          >
            {saving ? "Saving..." : saved ? "Saved!" : "Save"}
          </button>

          <button
            className="btn-secondary"
            onClick={handleTest}
            disabled={
              connectionStatus === "testing" ||
              !serverUrl.trim() ||
              !token.trim()
            }
          >
            {connectionStatus === "testing" ? "Testing..." : "Test Connection"}
          </button>

          {connectionStatus === "connected" && (
            <span className="status status-success">Connected</span>
          )}
          {connectionStatus === "error" && (
            <span className="status status-error">{connectionError}</span>
          )}
        </div>
      </section>
    </div>
  );
}
