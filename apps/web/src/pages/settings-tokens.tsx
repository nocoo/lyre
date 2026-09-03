import { PageHeader } from "@nocoo/basalt/components/page-header";
import { DeviceTokensSection } from "@/components/device-tokens";
import { useSetBreadcrumbs } from "@/components/layout";

export default function DeviceTokensPage() {
	useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Device Tokens" }]);

	return (
		<div className="space-y-6">
			<PageHeader
				title="Device Tokens"
				description="Generate tokens for programmatic API access."
			/>
			<DeviceTokensSection />
		</div>
	);
}
