import { CHART_COLORS, chart, chartAxis } from "@lyre/api/lib/palette";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { Clock, Database, Files, FileWarning, HardDrive, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ChartCardSkeleton } from "@/components/ui/chart-card-skeleton";
import { StatCardSkeleton } from "@/components/ui/stat-card-skeleton";

/** Safe chart color accessor (falls back to first color on out-of-bounds). */
function chartColor(index: number): string {
	return CHART_COLORS[index] ?? CHART_COLORS[0] ?? "#000000";
}

import { LayerCard } from "@nocoo/basalt/components/layer-card";
import {
	buildOssStatCards,
	buildRecordingStatCards,
	type DashboardData,
	formatTotalDuration,
	monthLabel,
	statusColorIndex,
	statusLabel,
} from "@/lib/dashboard-vm";
import { formatFileSize } from "@/lib/recordings-list-vm";

// ── Custom tooltip ──

function ChartTooltip({
	active,
	payload,
	label,
	formatter,
}: {
	active?: boolean;
	payload?: { value: number; name: string; color: string }[];
	label?: string;
	formatter?: (value: number) => string;
}) {
	if (!active || !payload?.length) return null;
	return (
		<div className="rounded-basalt-widget bg-basalt-popover px-3 py-2">
			{label && <p className="mb-1 text-xs text-basalt-muted-foreground">{label}</p>}
			{payload.map((entry) => (
				<div key={entry.name} className="flex items-center gap-2 text-sm">
					<div className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
					<span className="text-basalt-muted-foreground">{entry.name}:</span>
					<span className="font-medium text-basalt-foreground font-display">
						{formatter ? formatter(entry.value) : entry.value}
					</span>
				</div>
			))}
		</div>
	);
}

// ── Section header ──

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
	return (
		<LayerCard>
			<p className="text-xs text-basalt-muted-foreground md:text-sm">{label}</p>
			<p className="font-display text-xl font-semibold tracking-tight text-basalt-foreground md:text-2xl">
				{value}
			</p>
			{subtitle ? <p className="mt-0.5 text-xs text-basalt-muted-foreground">{subtitle}</p> : null}
		</LayerCard>
	);
}

// ── Recording charts ──

function RecordingsByMonthChart({ data }: { data: { month: string; count: number }[] }) {
	return (
		<LayerCard className="h-full">
			<LayerCard.Header>
				<div className="flex items-center gap-2">
					<Mic className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
					<span className="text-sm font-normal text-basalt-muted-foreground">
						Recordings by Month
					</span>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="flex flex-col">
				<div
					className="flex-1 min-h-[200px]"
					role="img"
					aria-label="Monthly recording count bar chart"
				>
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={data} barCategoryGap="25%">
							<CartesianGrid
								strokeDasharray="3 3"
								stroke={chartAxis}
								strokeOpacity={0.15}
								vertical={false}
							/>
							<XAxis
								dataKey="month"
								tickFormatter={monthLabel}
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
								width={30}
								allowDecimals={false}
							/>
							<Tooltip content={<ChartTooltip formatter={(v) => `${v} recordings`} />} />
							<Bar dataKey="count" name="Recordings" fill={chart.primary} radius={[4, 4, 0, 0]} />
						</BarChart>
					</ResponsiveContainer>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

function DurationByMonthChart({ data }: { data: { month: string; duration: number }[] }) {
	return (
		<LayerCard className="h-full">
			<LayerCard.Header>
				<div className="flex items-center gap-2">
					<Clock className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
					<span className="text-sm font-normal text-basalt-muted-foreground">
						Duration by Month
					</span>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="flex flex-col">
				<div
					className="flex-1 min-h-[200px]"
					role="img"
					aria-label="Monthly recording duration area chart"
				>
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={data}>
							<defs>
								<linearGradient id="durationGrad" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor={chart.teal} stopOpacity={0.3} />
									<stop offset="100%" stopColor={chart.teal} stopOpacity={0} />
								</linearGradient>
							</defs>
							<CartesianGrid
								strokeDasharray="3 3"
								stroke={chartAxis}
								strokeOpacity={0.15}
								vertical={false}
							/>
							<XAxis
								dataKey="month"
								tickFormatter={monthLabel}
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								tickFormatter={(v: number) => formatTotalDuration(v)}
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
								width={40}
							/>
							<Tooltip content={<ChartTooltip formatter={(v) => formatTotalDuration(v)} />} />
							<Area
								type="monotone"
								dataKey="duration"
								name="Duration"
								stroke={chart.teal}
								strokeWidth={2}
								fill="url(#durationGrad)"
							/>
						</AreaChart>
					</ResponsiveContainer>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

function StatusDonutChart({ data }: { data: { status: string; count: number }[] }) {
	const chartData = data
		.filter((d) => d.count > 0)
		.map((d) => ({
			name: statusLabel(d.status as "uploaded" | "transcribing" | "completed" | "failed"),
			value: d.count,
			colorIndex: statusColorIndex(
				d.status as "uploaded" | "transcribing" | "completed" | "failed",
			),
		}));

	const total = chartData.reduce((s, d) => s + d.value, 0);

	return (
		<LayerCard className="h-full">
			<LayerCard.Header>
				<div className="flex items-center gap-2">
					<Database className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
					<span className="text-sm font-normal text-basalt-muted-foreground">
						Status Distribution
					</span>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="flex flex-col">
				<div className="flex flex-1 flex-col items-center min-h-0">
					<div
						className="flex-1 min-h-0 w-full flex items-center justify-center"
						role="img"
						aria-label="Recording status distribution donut chart"
					>
						<div className="aspect-square h-full max-h-[180px] min-h-[100px]">
							<ResponsiveContainer width="100%" height="100%">
								<PieChart>
									<Pie
										data={chartData}
										cx="50%"
										cy="50%"
										innerRadius="50%"
										outerRadius="80%"
										dataKey="value"
										strokeWidth={0}
									>
										{chartData.map((entry) => (
											<Cell key={entry.name} fill={chartColor(entry.colorIndex)} />
										))}
									</Pie>
								</PieChart>
							</ResponsiveContainer>
						</div>
					</div>
					<div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-3">
						{chartData.map((item) => (
							<div key={item.name} className="flex flex-col items-center gap-0.5">
								<span className="text-sm font-medium text-basalt-foreground font-display">
									{total > 0 ? `${Math.round((item.value / total) * 100)}%` : "0%"}
								</span>
								<div className="flex items-center gap-1.5">
									<div
										className="h-2 w-2 rounded-full"
										style={{
											background: chartColor(item.colorIndex),
										}}
									/>
									<span className="text-xs text-basalt-muted-foreground">{item.name}</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

function FormatBarChart({
	data,
}: {
	data: { format: string; count: number; totalSize: number }[];
}) {
	if (data.length === 0) return null;

	const chartData = data.map((d) => ({
		format: d.format.toUpperCase(),
		count: d.count,
	}));

	return (
		<LayerCard className="h-full">
			<LayerCard.Header>
				<div className="flex items-center gap-2">
					<Files className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
					<span className="text-sm font-normal text-basalt-muted-foreground">
						Recordings by Format
					</span>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="flex flex-col">
				<div
					className="flex-1 min-h-[200px]"
					role="img"
					aria-label="Recording format distribution bar chart"
				>
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={chartData} barCategoryGap="25%">
							<CartesianGrid
								strokeDasharray="3 3"
								stroke={chartAxis}
								strokeOpacity={0.15}
								vertical={false}
							/>
							<XAxis
								dataKey="format"
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
								width={30}
								allowDecimals={false}
							/>
							<Tooltip content={<ChartTooltip formatter={(v) => `${v} recordings`} />} />
							<Bar dataKey="count" name="Recordings" fill={chart.purple} radius={[4, 4, 0, 0]} />
						</BarChart>
					</ResponsiveContainer>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

// ── OSS charts ──

function OssStorageByMonthChart({
	data,
}: {
	data: { month: string; uploads: number; results: number }[];
}) {
	return (
		<LayerCard className="h-full">
			<LayerCard.Header>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<HardDrive className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
						<span className="text-sm font-normal text-basalt-muted-foreground">
							Storage by Month
						</span>
					</div>
					<div className="flex items-center gap-4">
						<div className="flex items-center gap-1.5">
							<div className="h-2 w-2 rounded-full" style={{ background: chart.sky }} />
							<span className="text-xs text-basalt-muted-foreground">Uploads</span>
						</div>
						<div className="flex items-center gap-1.5">
							<div className="h-2 w-2 rounded-full" style={{ background: chart.amber }} />
							<span className="text-xs text-basalt-muted-foreground">Results</span>
						</div>
					</div>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="flex flex-col">
				<div
					className="flex-1 min-h-[200px]"
					role="img"
					aria-label="Monthly OSS storage grouped bar chart comparing uploads and results"
				>
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={data} barGap={4} barCategoryGap="20%">
							<CartesianGrid
								strokeDasharray="3 3"
								stroke={chartAxis}
								strokeOpacity={0.15}
								vertical={false}
							/>
							<XAxis
								dataKey="month"
								tickFormatter={monthLabel}
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								tickFormatter={(v: number) => formatFileSize(v)}
								tick={{ fill: chartAxis, fontSize: 11 }}
								axisLine={false}
								tickLine={false}
								width={50}
							/>
							<Tooltip content={<ChartTooltip formatter={(v) => formatFileSize(v)} />} />
							<Bar dataKey="uploads" name="Uploads" fill={chart.sky} radius={[4, 4, 0, 0]} />
							<Bar dataKey="results" name="Results" fill={chart.amber} radius={[4, 4, 0, 0]} />
						</BarChart>
					</ResponsiveContainer>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

function OssBreakdownDonut({ stats }: { stats: DashboardData["oss"] }) {
	const segments = [
		{
			name: "Audio Files",
			value: stats.uploads.totalSize - stats.uploads.orphanSize,
			colorIndex: 1,
		},
		{
			name: "ASR Results",
			value: stats.results.totalSize - stats.results.orphanSize,
			colorIndex: 6,
		},
		{
			name: "Orphan Uploads",
			value: stats.uploads.orphanSize,
			colorIndex: 9,
		},
		{
			name: "Orphan Results",
			value: stats.results.orphanSize,
			colorIndex: 10,
		},
	].filter((d) => d.value > 0);

	const total = segments.reduce((s, d) => s + d.value, 0);

	if (total === 0) {
		return (
			<LayerCard className="h-full">
				<LayerCard.Header>
					<div className="flex items-center gap-2">
						<FileWarning className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
						<span className="text-sm font-normal text-basalt-muted-foreground">
							Storage Breakdown
						</span>
					</div>
				</LayerCard.Header>
				<LayerCard.Body className="flex items-center justify-center min-h-[200px]">
					<p className="text-sm text-basalt-muted-foreground">No storage data</p>
				</LayerCard.Body>
			</LayerCard>
		);
	}

	return (
		<LayerCard className="h-full">
			<LayerCard.Header>
				<div className="flex items-center gap-2">
					<FileWarning className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
					<span className="text-sm font-normal text-basalt-muted-foreground">
						Storage Breakdown
					</span>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="flex flex-col">
				<div className="flex flex-1 flex-col items-center min-h-0">
					<div
						className="flex-1 min-h-0 w-full flex items-center justify-center"
						role="img"
						aria-label="OSS storage breakdown donut chart"
					>
						<div className="aspect-square h-full max-h-[180px] min-h-[100px]">
							<ResponsiveContainer width="100%" height="100%">
								<PieChart>
									<Pie
										data={segments}
										cx="50%"
										cy="50%"
										innerRadius="50%"
										outerRadius="80%"
										dataKey="value"
										strokeWidth={0}
									>
										{segments.map((entry) => (
											<Cell key={entry.name} fill={chartColor(entry.colorIndex)} />
										))}
									</Pie>
								</PieChart>
							</ResponsiveContainer>
						</div>
					</div>
					<div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-3">
						{segments.map((item) => (
							<div key={item.name} className="flex flex-col items-center gap-0.5">
								<span className="text-sm font-medium text-basalt-foreground font-display">
									{formatFileSize(item.value)}
								</span>
								<div className="flex items-center gap-1.5">
									<div
										className="h-2 w-2 rounded-full"
										style={{
											background: chartColor(item.colorIndex),
										}}
									/>
									<span className="text-xs text-basalt-muted-foreground">{item.name}</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

// ── Main page ──

export default function DashboardPage() {
	const [data, setData] = useState<DashboardData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function fetchData() {
			try {
				const res = await fetch("/api/dashboard");
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = (await res.json()) as DashboardData;
				if (!cancelled) setData(json);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		fetchData();
		return () => {
			cancelled = true;
		};
	}, []);

	if (loading) {
		return (
			<div className="space-y-8">
				<PageHeader title="Dashboard" description="Overview of recordings and object storage." />
				<SectionRule title="Recordings">
					<div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
						{Array.from({ length: 4 }, (_, i) => `rec-stat-${i}`).map((key) => (
							<StatCardSkeleton key={key} />
						))}
					</div>
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
						<div className="lg:col-span-2">
							<ChartCardSkeleton titleWidth="w-40" chartHeight="h-[220px]" />
						</div>
						<ChartCardSkeleton titleWidth="w-32" chartHeight="h-[220px]" />
					</div>
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
						<div className="lg:col-span-2">
							<ChartCardSkeleton titleWidth="w-36" chartHeight="h-[220px]" />
						</div>
						<ChartCardSkeleton titleWidth="w-40" chartHeight="h-[220px]" />
					</div>
				</SectionRule>
				<SectionRule title="OSS Storage">
					<div className="grid grid-cols-1 gap-3 md:gap-4 md:grid-cols-3">
						{Array.from({ length: 3 }, (_, i) => `oss-stat-${i}`).map((key) => (
							<StatCardSkeleton key={key} />
						))}
					</div>
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
						<div className="lg:col-span-2">
							<ChartCardSkeleton titleWidth="w-36" chartHeight="h-[220px]" />
						</div>
						<ChartCardSkeleton titleWidth="w-36" chartHeight="h-[220px]" />
					</div>
				</SectionRule>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="flex min-h-full flex-col items-center justify-center gap-2">
				<p className="text-sm text-basalt-destructive">Failed to load dashboard data</p>
				<p className="text-xs text-basalt-muted-foreground">{error}</p>
			</div>
		);
	}

	const recStats = buildRecordingStatCards(data.recordings);
	const ossStats = buildOssStatCards(data.oss);

	return (
		<div className="space-y-8">
			<PageHeader title="Dashboard" description="Overview of recordings and object storage." />
			<SectionRule
				title="Recordings"
				hint="Overview of your audio recordings and transcription status."
			>
				<div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
					{recStats.map((s) => (
						<StatCard key={s.label} {...s} />
					))}
				</div>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
					<div className="lg:col-span-2">
						<RecordingsByMonthChart data={data.recordings.byMonth} />
					</div>
					<StatusDonutChart data={data.recordings.byStatus} />
				</div>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
					<div className="lg:col-span-2">
						<DurationByMonthChart data={data.recordings.durationByMonth} />
					</div>
					<FormatBarChart data={data.recordings.byFormat} />
				</div>
			</SectionRule>
			<SectionRule
				title="OSS Storage"
				hint="Object storage usage, file distribution, and orphan detection."
			>
				<div className="grid grid-cols-1 gap-3 md:gap-4 md:grid-cols-3">
					{ossStats.map((s) => (
						<StatCard key={s.label} {...s} />
					))}
				</div>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
					<div className="lg:col-span-2">
						<OssStorageByMonthChart data={data.oss.sizeByMonth} />
					</div>
					<OssBreakdownDonut stats={data.oss} />
				</div>
			</SectionRule>
		</div>
	);
}
