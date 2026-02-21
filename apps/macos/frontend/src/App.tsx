import { useState } from "react";
import { SettingsPage } from "./SettingsPage";
import { RecordingsPage } from "./RecordingsPage";

type Tab = "recordings" | "settings";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("recordings");

  return (
    <div className="container">
      <div className="titlebar" data-tauri-drag-region>
        <nav className="tab-bar">
          <button
            className={`tab ${activeTab === "recordings" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("recordings")}
          >
            Recordings
          </button>
          <button
            className={`tab ${activeTab === "settings" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
        </nav>
      </div>

      {activeTab === "recordings" && <RecordingsPage />}
      {activeTab === "settings" && <SettingsPage />}
    </div>
  );
}
