"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Tooltip,
} from "recharts";
import {
  Mic,
  HardDrive,
  Clock,
  Database,
  FileWarning,
  Files,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { chart, chartAxis, CHART_COLORS } from "@/lib/palette";

/** Safe chart color accessor (falls back to first color on out-of-bounds). */
function chartColor(index: number): string {
  return CHART_COLORS[index] ?? CHART_COLORS[0]!;
}
import {
  type DashboardData,
  buildRecordingStatCards,
  buildOssStatCards,
  monthLabel,
  statusLabel,
  statusColorIndex,
  formatTotalDuration,
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
    <div className="rounded-widget border border-border bg-card px-3 py-2 shadow-sm">
      {label && (
        <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      )}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div
            className="h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground font-display">
            {formatter ? formatter(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Section header ──

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// ── Stat card ──

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-card bg-secondary p-4 md:p-5">
      <p className="text-xs md:text-sm text-muted-foreground mb-1">{label}</p>
      <h3 className="text-xl md:text-2xl font-semibold text-foreground font-display tracking-tight">
        {value}
      </h3>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

// ── Recording charts ──

function RecordingsByMonthChart({
  data,
}: {
  data: { month: string; count: number }[];
}) {
  return (
    <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mic
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Recordings by Month
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
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
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v) => `${v} recordings`}
                  />
                }
              />
              <Bar
                dataKey="count"
                name="Recordings"
                fill={chart.primary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function DurationByMonthChart({
  data,
}: {
  data: { month: string; duration: number }[];
}) {
  return (
    <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Duration by Month
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
        <div
          className="flex-1 min-h-[200px]"
          role="img"
          aria-label="Monthly recording duration area chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="durationGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={chart.teal}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={chart.teal}
                    stopOpacity={0}
                  />
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
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v) => formatTotalDuration(v)}
                  />
                }
              />
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
      </CardContent>
    </Card>
  );
}

function StatusDonutChart({
  data,
}: {
  data: { status: string; count: number }[];
}) {
  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: statusLabel(d.status as "uploaded" | "transcribing" | "completed" | "failed"),
      value: d.count,
      colorIndex: statusColorIndex(d.status as "uploaded" | "transcribing" | "completed" | "failed"),
    }));

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Status Distribution
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
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
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={chartColor(entry.colorIndex)}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-3">
            {chartData.map((item) => (
              <div
                key={item.name}
                className="flex flex-col items-center gap-0.5"
              >
                <span className="text-sm font-medium text-foreground font-display">
                  {total > 0
                    ? `${Math.round((item.value / total) * 100)}%`
                    : "0%"}
                </span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: chartColor(item.colorIndex),
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {item.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
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
    <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Files
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Recordings by Format
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
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
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v) => `${v} recordings`}
                  />
                }
              />
              <Bar
                dataKey="count"
                name="Recordings"
                fill={chart.purple}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ── OSS charts ──

function OssStorageByMonthChart({
  data,
}: {
  data: { month: string; uploads: number; results: number }[];
}) {
  return (
    <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Storage by Month
            </CardTitle>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: chart.sky }}
              />
              <span className="text-xs text-muted-foreground">Uploads</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: chart.amber }}
              />
              <span className="text-xs text-muted-foreground">Results</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
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
              <Tooltip
                content={
                  <ChartTooltip formatter={(v) => formatFileSize(v)} />
                }
              />
              <Bar
                dataKey="uploads"
                name="Uploads"
                fill={chart.sky}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="results"
                name="Results"
                fill={chart.amber}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
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
      <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileWarning
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Storage Breakdown
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-center min-h-[200px]">
          <p className="text-sm text-muted-foreground">No storage data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full rounded-card border-0 bg-secondary shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileWarning
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Storage Breakdown
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
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
                    {segments.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={chartColor(entry.colorIndex)}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-3">
            {segments.map((item) => (
              <div
                key={item.name}
                className="flex flex-col items-center gap-0.5"
              >
                <span className="text-sm font-medium text-foreground font-display">
                  {formatFileSize(item.value)}
                </span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: chartColor(item.colorIndex),
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {item.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
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
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <p className="text-sm text-destructive">
          Failed to load dashboard data
        </p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  const recStats = buildRecordingStatCards(data.recordings);
  const ossStats = buildOssStatCards(data.oss);

  return (
    <div className="space-y-8">
      {/* ── Recordings section ── */}
      <section>
        <SectionHeader
          icon={Mic}
          title="Recordings"
          description="Overview of your audio recordings and transcription status."
        />

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4 mt-4">
          {recStats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        {/* Row 1: monthly bar chart + status donut */}
        <div className="grid grid-cols-1 gap-4 mt-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecordingsByMonthChart data={data.recordings.byMonth} />
          </div>
          <StatusDonutChart data={data.recordings.byStatus} />
        </div>

        {/* Row 2: duration area chart + format bar chart */}
        <div className="grid grid-cols-1 gap-4 mt-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DurationByMonthChart data={data.recordings.durationByMonth} />
          </div>
          <FormatBarChart data={data.recordings.byFormat} />
        </div>
      </section>

      {/* ── OSS Storage section ── */}
      <section>
        <SectionHeader
          icon={HardDrive}
          title="OSS Storage"
          description="Object storage usage, file distribution, and orphan detection."
        />

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-3 md:gap-4 md:grid-cols-3 mt-4">
          {ossStats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        {/* Row 1: monthly storage chart + breakdown donut */}
        <div className="grid grid-cols-1 gap-4 mt-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OssStorageByMonthChart data={data.oss.sizeByMonth} />
          </div>
          <OssBreakdownDonut stats={data.oss} />
        </div>
      </section>
    </div>
  );
}
