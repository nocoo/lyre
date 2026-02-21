"use client";

import { useSetBreadcrumbs } from "@/components/layout";
import { DeviceTokensSection } from "@/components/device-tokens";

export default function DeviceTokensPage() {
  useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Device Tokens" }]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Device Tokens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate tokens for programmatic API access.
        </p>
      </div>

      <DeviceTokensSection />
    </div>
  );
}
