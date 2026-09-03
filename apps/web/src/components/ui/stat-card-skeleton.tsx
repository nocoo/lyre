import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for a stat cell (label + big value + optional helper).
 * Matches the `rounded-basalt-card bg-basalt-secondary p-4 md:p-5` shell used by StatCard.
 */
export function StatCardSkeleton() {
	return (
		<div className="rounded-basalt-card bg-basalt-secondary p-4 md:p-5 space-y-2">
			<Skeleton className="h-3 w-20" />
			<Skeleton className="h-7 w-16" />
			<Skeleton className="h-3 w-14" />
		</div>
	);
}
