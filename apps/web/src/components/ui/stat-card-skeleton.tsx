import { Skeleton } from "@/components/ui/skeleton";
import { LayerCard } from "@nocoo/basalt/components/layer-card";

/**
 * Loading skeleton for a stat cell (label + big value + optional helper).
 * Matches the `rounded-basalt-card bg-basalt-secondary p-4 md:p-5` shell used by StatCard.
 */
export function StatCardSkeleton() {
	return (
		<LayerCard className="p-4 md:p-5 space-y-2">
			<Skeleton className="h-3 w-20" />
			<Skeleton className="h-7 w-16" />
			<Skeleton className="h-3 w-14" />
		</LayerCard>
	);
}
