import { Routes, Route } from "react-router";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout";
import { RequireAuth } from "@/components/require-auth";
import DashboardPage from "@/pages/dashboard";
import RecordingsListPage from "@/pages/recordings-list";
import RecordingDetailPage from "@/pages/recording-detail";
import SettingsPage from "@/pages/settings";
import SettingsAiPage from "@/pages/settings-ai";
import SettingsStoragePage from "@/pages/settings-storage";
import SettingsTokensPage from "@/pages/settings-tokens";

export function App() {
  return (
    <RequireAuth>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/recordings" element={<RecordingsListPage />} />
          <Route path="/recordings/:id" element={<RecordingDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/ai" element={<SettingsAiPage />} />
          <Route path="/settings/storage" element={<SettingsStoragePage />} />
          <Route path="/settings/tokens" element={<SettingsTokensPage />} />
        </Routes>
      </AppShell>
      <Toaster theme="system" />
    </RequireAuth>
  );
}
