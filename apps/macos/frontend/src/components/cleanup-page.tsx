"use client";

import { useState, useCallback, useMemo } from "react";
import {
  ArrowLeft,
  Search,
  Trash2,
  Loader2,
  Calendar,
  Clock,
  HardDrive,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { previewCleanup, batchDeleteRecordings } from "@/lib/commands";
import type { RecordingInfo, CleanupFilter } from "@/lib/commands";

interface CleanupPageProps {
  onBack: () => void;
}

type Step = "configure" | "preview" | "deleting";

// Preset age options in days
const AGE_PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

// Preset duration options in seconds
const MIN_DURATION_PRESETS = [
  { label: "< 3s", secs: 3 },
  { label: "< 10s", secs: 10 },
  { label: "< 30s", secs: 30 },
] as const;

const MAX_DURATION_PRESETS = [
  { label: "> 30 min", secs: 30 * 60 },
  { label: "> 1 hr", secs: 60 * 60 },
  { label: "> 2 hr", secs: 2 * 60 * 60 },
] as const;

// Preset size options in bytes
const SIZE_PRESETS = [
  { label: "> 50 MB", bytes: 50 * 1024 * 1024 },
  { label: "> 100 MB", bytes: 100 * 1024 * 1024 },
  { label: "> 500 MB", bytes: 500 * 1024 * 1024 },
] as const;

export function CleanupPage({ onBack }: CleanupPageProps) {
  // Filter state
  const [beforeDays, setBeforeDays] = useState<number | null>(null);
  const [customBeforeDays, setCustomBeforeDays] = useState("");
  const [minDurationSecs, setMinDurationSecs] = useState<number | null>(null);
  const [customMinDuration, setCustomMinDuration] = useState("");
  const [maxDurationSecs, setMaxDurationSecs] = useState<number | null>(null);
  const [customMaxDuration, setCustomMaxDuration] = useState("");
  const [maxSizeBytes, setMaxSizeBytes] = useState<number | null>(null);
  const [customMaxSizeMb, setCustomMaxSizeMb] = useState("");

  // Preview/delete state
  const [step, setStep] = useState<Step>("configure");
  const [previewing, setPreviewing] = useState(false);
  const [matched, setMatched] = useState<RecordingInfo[]>([]);
  const [deleting, setDeleting] = useState(false);

  const hasAnyFilter =
    beforeDays !== null ||
    minDurationSecs !== null ||
    maxDurationSecs !== null ||
    maxSizeBytes !== null;

  const buildFilter = useCallback((): CleanupFilter => {
    let before_date: string | null = null;
    if (beforeDays !== null) {
      const d = new Date();
      d.setDate(d.getDate() - beforeDays);
      // Format to match the ISO 8601 format used by recordings (with timezone)
      before_date = formatISOLocal(d);
    }
    return {
      before_date,
      min_duration_secs: minDurationSecs,
      max_duration_secs: maxDurationSecs,
      max_size_bytes: maxSizeBytes,
    };
  }, [beforeDays, minDurationSecs, maxDurationSecs, maxSizeBytes]);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const filter = buildFilter();
      const result = await previewCleanup(filter);
      setMatched(result);
      setStep("preview");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPreviewing(false);
    }
  }, [buildFilter]);

  const handleDelete = useCallback(async () => {
    if (matched.length === 0) return;
    setDeleting(true);
    setStep("deleting");
    try {
      const paths = matched.map((r) => r.path);
      const result = await batchDeleteRecordings(paths);
      if (result.errors.length > 0) {
        toast.warning(
          `Deleted ${result.deleted_count} files (${result.errors.length} failed)`
        );
      } else {
        toast.success(
          `Deleted ${result.deleted_count} files, freed ${formatSize(result.freed_bytes)}`
        );
      }
      onBack();
    } catch (err) {
      toast.error(String(err));
      setStep("preview");
    } finally {
      setDeleting(false);
    }
  }, [matched, onBack]);

  const totalSize = useMemo(
    () => matched.reduce((sum, r) => sum + r.size, 0),
    [matched]
  );

  const handleBackFromPreview = useCallback(() => {
    setStep("configure");
    setMatched([]);
  }, []);

  return (
    <div
      className="flex h-screen flex-col pt-[74px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <header
        data-tauri-drag-region
        className="fixed top-0 right-0 left-0 z-50 border-b bg-background"
      >
        <div data-tauri-drag-region className="h-[38px]" />
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 px-4 pb-3"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={step === "preview" ? handleBackFromPreview : onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">
            {step === "preview" ? "Review" : "Cleanup"}
          </h1>
        </div>
      </header>

      {step === "configure" && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-5">
              <p className="text-[11px] text-muted-foreground">
                Select criteria to find recordings to clean up. Files matching{" "}
                <strong className="text-foreground">any</strong> enabled filter
                will be included.
              </p>

              {/* Filter: Created before */}
              <FilterSection
                icon={Calendar}
                title="Created Before"
                description="Remove old recordings"
              >
                <div className="flex flex-wrap gap-1.5">
                  {AGE_PRESETS.map((p) => (
                    <Button
                      key={p.days}
                      variant={beforeDays === p.days ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setBeforeDays(beforeDays === p.days ? null : p.days)
                      }
                    >
                      {p.label} ago
                    </Button>
                  ))}
                  <Button
                    variant={
                      beforeDays !== null &&
                      !AGE_PRESETS.some((p) => p.days === beforeDays)
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const parsed = parseInt(customBeforeDays);
                      if (!isNaN(parsed) && parsed > 0) {
                        setBeforeDays(parsed);
                      }
                    }}
                  >
                    Custom
                  </Button>
                </div>
                {beforeDays !== null &&
                  !AGE_PRESETS.some((p) => p.days === beforeDays) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={customBeforeDays}
                        onChange={(e) => {
                          setCustomBeforeDays(e.target.value);
                          const parsed = parseInt(e.target.value);
                          if (!isNaN(parsed) && parsed > 0)
                            setBeforeDays(parsed);
                        }}
                        placeholder="days"
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">
                        days ago
                      </span>
                    </div>
                  )}
                {beforeDays !== null && (
                  <button
                    className="mt-1 text-[11px] text-muted-foreground underline"
                    onClick={() => {
                      setBeforeDays(null);
                      setCustomBeforeDays("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </FilterSection>

              {/* Filter: Too short */}
              <FilterSection
                icon={Clock}
                title="Too Short"
                description="Remove accidental or trivially short recordings"
              >
                <div className="flex flex-wrap gap-1.5">
                  {MIN_DURATION_PRESETS.map((p) => (
                    <Button
                      key={p.secs}
                      variant={
                        minDurationSecs === p.secs ? "default" : "outline"
                      }
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setMinDurationSecs(
                          minDurationSecs === p.secs ? null : p.secs
                        )
                      }
                    >
                      {p.label}
                    </Button>
                  ))}
                  <Button
                    variant={
                      minDurationSecs !== null &&
                      !MIN_DURATION_PRESETS.some(
                        (p) => p.secs === minDurationSecs
                      )
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const parsed = parseInt(customMinDuration);
                      if (!isNaN(parsed) && parsed > 0) {
                        setMinDurationSecs(parsed);
                      }
                    }}
                  >
                    Custom
                  </Button>
                </div>
                {minDurationSecs !== null &&
                  !MIN_DURATION_PRESETS.some(
                    (p) => p.secs === minDurationSecs
                  ) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={customMinDuration}
                        onChange={(e) => {
                          setCustomMinDuration(e.target.value);
                          const parsed = parseInt(e.target.value);
                          if (!isNaN(parsed) && parsed > 0)
                            setMinDurationSecs(parsed);
                        }}
                        placeholder="seconds"
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">
                        seconds
                      </span>
                    </div>
                  )}
                {minDurationSecs !== null && (
                  <button
                    className="mt-1 text-[11px] text-muted-foreground underline"
                    onClick={() => {
                      setMinDurationSecs(null);
                      setCustomMinDuration("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </FilterSection>

              {/* Filter: Too long */}
              <FilterSection
                icon={Clock}
                title="Too Long"
                description="Remove unusually long recordings"
              >
                <div className="flex flex-wrap gap-1.5">
                  {MAX_DURATION_PRESETS.map((p) => (
                    <Button
                      key={p.secs}
                      variant={
                        maxDurationSecs === p.secs ? "default" : "outline"
                      }
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setMaxDurationSecs(
                          maxDurationSecs === p.secs ? null : p.secs
                        )
                      }
                    >
                      {p.label}
                    </Button>
                  ))}
                  <Button
                    variant={
                      maxDurationSecs !== null &&
                      !MAX_DURATION_PRESETS.some(
                        (p) => p.secs === maxDurationSecs
                      )
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const parsed = parseInt(customMaxDuration);
                      if (!isNaN(parsed) && parsed > 0) {
                        setMaxDurationSecs(parsed * 60); // input in minutes
                      }
                    }}
                  >
                    Custom
                  </Button>
                </div>
                {maxDurationSecs !== null &&
                  !MAX_DURATION_PRESETS.some(
                    (p) => p.secs === maxDurationSecs
                  ) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={customMaxDuration}
                        onChange={(e) => {
                          setCustomMaxDuration(e.target.value);
                          const parsed = parseInt(e.target.value);
                          if (!isNaN(parsed) && parsed > 0)
                            setMaxDurationSecs(parsed * 60);
                        }}
                        placeholder="minutes"
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">
                        minutes
                      </span>
                    </div>
                  )}
                {maxDurationSecs !== null && (
                  <button
                    className="mt-1 text-[11px] text-muted-foreground underline"
                    onClick={() => {
                      setMaxDurationSecs(null);
                      setCustomMaxDuration("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </FilterSection>

              {/* Filter: File too large */}
              <FilterSection
                icon={HardDrive}
                title="File Too Large"
                description="Remove oversized recording files"
              >
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_PRESETS.map((p) => (
                    <Button
                      key={p.bytes}
                      variant={
                        maxSizeBytes === p.bytes ? "default" : "outline"
                      }
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setMaxSizeBytes(
                          maxSizeBytes === p.bytes ? null : p.bytes
                        )
                      }
                    >
                      {p.label}
                    </Button>
                  ))}
                  <Button
                    variant={
                      maxSizeBytes !== null &&
                      !SIZE_PRESETS.some((p) => p.bytes === maxSizeBytes)
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const parsed = parseInt(customMaxSizeMb);
                      if (!isNaN(parsed) && parsed > 0) {
                        setMaxSizeBytes(parsed * 1024 * 1024);
                      }
                    }}
                  >
                    Custom
                  </Button>
                </div>
                {maxSizeBytes !== null &&
                  !SIZE_PRESETS.some((p) => p.bytes === maxSizeBytes) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={customMaxSizeMb}
                        onChange={(e) => {
                          setCustomMaxSizeMb(e.target.value);
                          const parsed = parseInt(e.target.value);
                          if (!isNaN(parsed) && parsed > 0)
                            setMaxSizeBytes(parsed * 1024 * 1024);
                        }}
                        placeholder="MB"
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">MB</span>
                    </div>
                  )}
                {maxSizeBytes !== null && (
                  <button
                    className="mt-1 text-[11px] text-muted-foreground underline"
                    onClick={() => {
                      setMaxSizeBytes(null);
                      setCustomMaxSizeMb("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </FilterSection>
            </div>
          </div>

          {/* Find button — sticky bottom */}
          <div className="border-t px-4 py-3">
            <Button
              onClick={handlePreview}
              disabled={!hasAnyFilter || previewing}
              size="sm"
              className="w-full gap-1.5"
            >
              {previewing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" />
              )}
              {previewing ? "Scanning..." : "Find Matching Files"}
            </Button>
          </div>
        </>
      )}

      {step === "preview" && (
        <>
          <div className="flex flex-1 flex-col overflow-hidden">
            {matched.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
                <Search className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No matching recordings found
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  Try adjusting your filter criteria
                </p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {matched.length} file{matched.length !== 1 ? "s" : ""} ·{" "}
                    {formatSize(totalSize)}
                  </span>
                  <Badge variant="destructive" className="text-[10px]">
                    Will be deleted
                  </Badge>
                </div>

                {/* File list */}
                <ScrollArea className="flex-1">
                  <div className="divide-y divide-border">
                    {matched.map((rec) => (
                      <div
                        key={rec.path}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {rec.name}
                          </span>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {formatSize(rec.size)}
                            {rec.duration_secs != null &&
                              ` · ${formatDuration(rec.duration_secs)}`}
                            {" · "}
                            {formatDate(rec.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          {/* Delete button — sticky bottom */}
          {matched.length > 0 && (
            <div className="space-y-2 border-t px-4 py-3">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />
                <span>
                  This action cannot be undone. Files will be permanently
                  deleted.
                </span>
              </div>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                size="sm"
                className="w-full gap-1.5"
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {deleting
                  ? "Deleting..."
                  : `Delete ${matched.length} File${matched.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Sub-components ---

function FilterSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

// --- Formatters ---

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Format a Date to the same ISO 8601 format used by the Rust backend. */
function formatISOLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absH = Math.floor(Math.abs(offset) / 60);
  const absM = Math.abs(offset) % 60;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(absH)}${pad(absM)}`
  );
}
