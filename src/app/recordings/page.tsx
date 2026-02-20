"use client";

import { useState, useMemo } from "react";
import { Search, SlidersHorizontal, Mic } from "lucide-react";
import { AppShell } from "@/components/layout";
import { RecordingCard } from "@/components/recording-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MOCK_RECORDINGS } from "@/lib/mock-data";
import {
  filterRecordings,
  sortRecordings,
  paginateRecordings,
  toRecordingsListVM,
  type SortField,
  type SortDirection,
} from "@/lib/recordings-list-vm";
import type { RecordingStatus } from "@/lib/types";

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

const PAGE_SIZE = 10;

export default function RecordingsPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecordingStatus | "all">(
    "all",
  );
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const listVM = useMemo(() => {
    const filtered = filterRecordings(MOCK_RECORDINGS, query, statusFilter);
    const sorted = sortRecordings(filtered, sortField, sortDirection);
    const paginated = paginateRecordings(sorted, page, PAGE_SIZE);
    return toRecordingsListVM(paginated);
  }, [query, statusFilter, sortField, sortDirection, page]);

  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    setPage(1);
  };

  return (
    <AppShell breadcrumbs={[{ label: "Recordings" }]}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Recordings</h1>
          <Button size="sm" className="gap-2">
            <Mic className="h-4 w-4" strokeWidth={1.5} />
            Upload
          </Button>
        </div>

        {/* Search + filter toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search recordings..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="icon"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </Button>
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
                    className="cursor-pointer"
                    onClick={() => handleSortToggle(opt.value)}
                  >
                    {opt.label}
                    {sortField === opt.value &&
                      (sortDirection === "asc" ? " ↑" : " ↓")}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Results count */}
        <p className="text-xs text-muted-foreground">
          {listVM.total} recording{listVM.total !== 1 ? "s" : ""}
          {statusFilter !== "all" && ` (${statusFilter})`}
        </p>

        {/* Recording cards */}
        {listVM.isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Mic className="h-12 w-12 mb-3" strokeWidth={1} />
            <p className="text-sm">No recordings found</p>
            <p className="text-xs mt-1">
              {query || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Upload your first recording to get started"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {listVM.cards.map((card) => (
              <RecordingCard key={card.id} recording={card} />
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
    </AppShell>
  );
}
