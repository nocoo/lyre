"use client";

import { useSetBreadcrumbs } from "@/components/layout";
import { OssStorageSection } from "@/components/oss-storage";

export default function StoragePage() {
  useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Storage" }]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Storage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit OSS storage usage, detect orphan files, and clean up unused data.
        </p>
      </div>

      <OssStorageSection />
    </div>
  );
}
