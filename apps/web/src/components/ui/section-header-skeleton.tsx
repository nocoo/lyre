import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for a section header (icon square + title line + description line).
 * Matches the layout used by dashboard `<SectionHeader>` and settings section headers.
 */
export function SectionHeaderSkeleton() {
	return (
		<div className="flex items-start gap-3">
			<Skeleton className="h-9 w-9 rounded-lg" />
			<div className="space-y-2 pt-0.5">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="h-4 w-56" />
			</div>
		</div>
	);
}
