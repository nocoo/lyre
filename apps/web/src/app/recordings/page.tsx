"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  SlidersHorizontal,
  Mic,
  List,
  LayoutGrid,
  ArrowUpDown,
} from "lucide-react";
import { AppShell } from "@/components/layout";
import { RecordingListItem } from "@/components/recording-list-item";
import { RecordingTileCard } from "@/components/recording-tile-card";
import { UploadDialog } from "@/components/upload-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  toRecordingsListVM,
  type SortField,
  type SortDirection,
} from "@/lib/recordings-list-vm";
import type {
  RecordingListItem as RecordingListItemType,
  RecordingStatus,
  PaginatedResponse,
  Tag,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Constants ──

type ViewMode = "list" | "tile";

const STATUS_OPTIONS: { value: RecordingStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "uploaded", label: "Uploaded" },
  { value: "transcribing", label: "Transcribing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "createdAt", label: "Date" },
  { value: "title", label: "Title" },
  { value: "duration", label: "Duration" },
  { value: "fileSize", label: "Size" },
];

const PAGE_SIZE = 20;

export default function RecordingsPage() {
  return (
    <Suspense>
      <RecordingsPageInner />
    </Suspense>
  );
}

function RecordingsPageInner() {
  // ── State ──
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<RecordingStatus | "all">("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Folder filter comes from URL query param (managed by sidebar)
  const folderParam = searchParams.get("folder"); // null = all, "unfiled" = unfiled, string = folder id

  // Data
  const [recordings, setRecordings] = useState<PaginatedResponse<RecordingListItemType>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 0,
  });
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch tags once ──
  useEffect(() => {
    const fetchTags = async () => {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const data = (await res.json()) as { items: Tag[] };
        setTags(data.items);
      }
    };
    void fetchTags();
  }, []);

  // ── Fetch recordings ──
  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (folderParam !== null) params.set("folderId", folderParam);
      params.set("sortBy", sortField);
      params.set("sortDir", sortDirection);
      params.set("page", page.toString());
      params.set("pageSize", PAGE_SIZE.toString());

      const res = await fetch(`/api/recordings?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as PaginatedResponse<RecordingListItemType>;
        setRecordings(data);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, folderParam, sortField, sortDirection, page]);

  useEffect(() => {
    void fetchRecordings();
  }, [fetchRecordings]);

  const listVM = toRecordingsListVM(recordings);

  // ── Handlers ──
  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    setPage(1);
  };

  const handleUploadComplete = useCallback(() => {
    void fetchRecordings();
  }, [fetchRecordings]);

  return (
    <AppShell breadcrumbs={[{ label: "Recordings" }]}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Recordings</h1>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex h-8 w-8 items-center justify-center transition-colors",
                  viewMode === "list"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
                aria-label="List view"
              >
                <List className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setViewMode("tile")}
                className={cn(
                  "flex h-8 w-8 items-center justify-center transition-colors",
                  viewMode === "tile"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* Filter toggle */}
            <Button
              variant={showFilters ? "secondary" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
              Filters
              {(statusFilter !== "all") && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px]">
                  1
                </span>
              )}
            </Button>

            {/* Upload */}
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setShowUpload(true)}
            >
              <Mic className="h-4 w-4" strokeWidth={1.5} />
              Upload
            </Button>
          </div>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            {/* Status filter */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Status
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => (
                  <Badge
                    key={opt.value}
                    variant={
                      statusFilter === opt.value ? "default" : "secondary"
                    }
                    className="cursor-pointer"
                    onClick={() => {
                      setStatusFilter(opt.value);
                      setPage(1);
                    }}
                  >
                    {opt.label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Sort */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Sort by
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SORT_OPTIONS.map((opt) => (
                  <Badge
                    key={opt.value}
                    variant={sortField === opt.value ? "default" : "secondary"}
                    className="cursor-pointer gap-1"
                    onClick={() => handleSortToggle(opt.value)}
                  >
                    {opt.label}
                    {sortField === opt.value && (
                      <ArrowUpDown className="h-3 w-3" strokeWidth={1.5} />
                    )}
                    {sortField === opt.value &&
                      (sortDirection === "asc" ? " ↑" : " ↓")}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Tag filter */}
            {tags.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="cursor-pointer text-[10px]"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results summary */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Loading..."
              : `${listVM.total} recording${listVM.total !== 1 ? "s" : ""}${statusFilter !== "all" ? ` · ${statusFilter}` : ""}${folderParam ? ` · ${folderParam === "unfiled" ? "Unfiled" : folderParam}` : ""}`}
          </p>
        </div>

        {/* Recording list/grid */}
        {listVM.isEmpty && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Mic className="h-12 w-12 mb-3" strokeWidth={1} />
            <p className="text-sm">No recordings found</p>
            <p className="text-xs mt-1">
              {statusFilter !== "all" || folderParam !== null
                ? "Try adjusting your filters"
                : "Upload your first recording to get started"}
            </p>
          </div>
        ) : viewMode === "list" ? (
          <div className="space-y-2">
            {listVM.cards.map((card) => (
              <RecordingListItem key={card.id} recording={card} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {listVM.cards.map((card) => (
              <RecordingTileCard key={card.id} recording={card} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {listVM.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!listVM.hasPreviousPage}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {listVM.page} of {listVM.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!listVM.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <UploadDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        onUploadComplete={handleUploadComplete}
      />
    </AppShell>
  );
}
