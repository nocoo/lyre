import { Skeleton } from "@/components/ui/skeleton";

interface ChartCardSkeletonProps {
	/** Tailwind width class for the title bar (default "w-32"). */
	titleWidth?: string;
	/** Tailwind height class(es) for the chart body (e.g. "h-[280px]"). */
	chartHeight: string;
}

/**
 * Loading skeleton for a chart card (icon + title header + chart body).
 * Matches the `rounded-basalt-card bg-basalt-secondary` shell used by dashboard charts.
 */
export function ChartCardSkeleton({
	titleWidth = "w-32",
	chartHeight,
}: ChartCardSkeletonProps) {
	return (
		<div className="rounded-basalt-card bg-basalt-secondary p-4 md:p-5 h-full">
			<div className="mb-4 flex items-center gap-2">
				<Skeleton className="h-4 w-4 rounded-sm" />
				<Skeleton className={`h-3 ${titleWidth}`} />
			</div>
			<Skeleton className={`${chartHeight} w-full`} />
		</div>
	);
}
