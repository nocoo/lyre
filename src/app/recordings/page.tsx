"use client";

import { useState, useEffect, useCallback } from "react";
import {
  SlidersHorizontal,
  Mic,
  FolderOpen,
  FolderClosed,
  Inbox,
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
  Folder,
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
  // ── State ──
  const [statusFilter, setStatusFilter] = useState<RecordingStatus | "all">("all");
  const [folderFilter, setFolderFilter] = useState<string | undefined>(undefined); // undefined = all, "unfiled" = no folder, folder id
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Data
  const [recordings, setRecordings] = useState<PaginatedResponse<RecordingListItemType>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 0,
  });
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch folders & tags once ──
  useEffect(() => {
    const fetchMeta = async () => {
      const [foldersRes, tagsRes] = await Promise.all([
        fetch("/api/folders"),
        fetch("/api/tags"),
      ]);
      if (foldersRes.ok) {
        const data = (await foldersRes.json()) as { items: Folder[] };
        setFolders(data.items);
      }
      if (tagsRes.ok) {
        const data = (await tagsRes.json()) as { items: Tag[] };
        setTags(data.items);
      }
    };
    void fetchMeta();
  }, []);

  // ── Fetch recordings ──
  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (folderFilter !== undefined) params.set("folderId", folderFilter);
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
  }, [statusFilter, folderFilter, sortField, sortDirection, page]);

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

  const handleFolderSelect = (folderId: string | undefined) => {
    setFolderFilter(folderId);
    setPage(1);
  };

  const handleUploadComplete = useCallback(() => {
    void fetchRecordings();
  }, [fetchRecordings]);

  // Folder counts are not available from the filtered API — folders are displayed as navigation only

  return (
    <AppShell breadcrumbs={[{ label: "Recordings" }]}>
      <div className="flex gap-6">
        {/* ── Left: Folder tree ── */}
        <div className="hidden md:block w-48 shrink-0">
          <div className="sticky top-0 space-y-1">
            <p className="text-xs font-medium text-muted-foreground px-2 mb-2">
              Folders
            </p>

            {/* All recordings */}
            <button
              onClick={() => handleFolderSelect(undefined)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                folderFilter === undefined
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Mic className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate">All Recordings</span>
            </button>

            {/* Unfiled */}
            <button
              onClick={() => handleFolderSelect("unfiled")}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                folderFilter === "unfiled"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Inbox className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Unfiled</span>
            </button>

            {/* Folder list */}
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => handleFolderSelect(folder.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  folderFilter === folder.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {folderFilter === folder.id ? (
                  <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                ) : (
                  <FolderClosed className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                )}
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Main content ── */}
        <div className="flex-1 min-w-0 space-y-4">
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

          {/* Mobile folder selector */}
          <div className="md:hidden">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <Badge
                variant={folderFilter === undefined ? "default" : "secondary"}
                className="cursor-pointer shrink-0"
                onClick={() => handleFolderSelect(undefined)}
              >
                All
              </Badge>
              <Badge
                variant={folderFilter === "unfiled" ? "default" : "secondary"}
                className="cursor-pointer shrink-0"
                onClick={() => handleFolderSelect("unfiled")}
              >
                Unfiled
              </Badge>
              {folders.map((folder) => (
                <Badge
                  key={folder.id}
                  variant={folderFilter === folder.id ? "default" : "secondary"}
                  className="cursor-pointer shrink-0"
                  onClick={() => handleFolderSelect(folder.id)}
                >
                  {folder.name}
                </Badge>
              ))}
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
                : `${listVM.total} recording${listVM.total !== 1 ? "s" : ""}${statusFilter !== "all" ? ` · ${statusFilter}` : ""}${folderFilter ? ` · ${folderFilter === "unfiled" ? "Unfiled" : folders.find((f) => f.id === folderFilter)?.name ?? ""}` : ""}`}
            </p>
          </div>

          {/* Recording list/grid */}
          {listVM.isEmpty && !loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Mic className="h-12 w-12 mb-3" strokeWidth={1} />
              <p className="text-sm">No recordings found</p>
              <p className="text-xs mt-1">
                {statusFilter !== "all" || folderFilter !== undefined
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
