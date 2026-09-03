import { PageHeader } from "@nocoo/basalt/components/page-header";
import { AiSettingsSection } from "@/components/ai-settings";
import { AsrSettingsSection } from "@/components/asr-settings";
import { useSetBreadcrumbs } from "@/components/layout";

export default function AiSettingsPage() {
	useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "AI Settings" }]);

	return (
		<div className="space-y-6">
			<PageHeader
				title="AI & ASR Settings"
				description="Configure LLM provider and speech recognition model."
			/>
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<AiSettingsSection />
				<AsrSettingsSection />
			</div>
		</div>
	);
}
