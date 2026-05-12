
import { useSetBreadcrumbs } from "@/components/layout";
import { AiSettingsSection } from "@/components/ai-settings";
import { AsrSettingsSection } from "@/components/asr-settings";

export default function AiSettingsPage() {
  useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "AI Settings" }]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI & ASR Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure LLM provider and speech recognition model.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <AiSettingsSection />
        <AsrSettingsSection />
      </div>
    </div>
  );
}
