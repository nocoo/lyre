import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useSetBreadcrumbs } from "@/components/layout";
import { OssStorageSection } from "@/components/oss-storage";

export default function StoragePage() {
	useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Storage" }]);

	return (
		<div className="space-y-6">
			<PageHeader
				title="Storage"
				description="Audit OSS storage usage, detect orphan files, and clean up unused data."
			/>
			<OssStorageSection />
		</div>
	);
}
