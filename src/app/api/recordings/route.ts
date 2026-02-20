import { NextResponse, type NextRequest } from "next/server";
import { MOCK_RECORDINGS } from "@/lib/mock-data";
import {
  filterRecordings,
  sortRecordings,
  paginateRecordings,
  type SortField,
  type SortDirection,
} from "@/lib/recordings-list-vm";
import type { RecordingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_SORT_FIELDS: SortField[] = [
  "createdAt",
  "title",
  "duration",
  "fileSize",
];
const VALID_SORT_DIRECTIONS: SortDirection[] = ["asc", "desc"];
const VALID_STATUSES: (RecordingStatus | "all")[] = [
  "all",
  "uploaded",
  "transcribing",
  "completed",
  "failed",
];

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const query = searchParams.get("q") ?? "";
  const statusParam = searchParams.get("status") ?? "all";
  const sortFieldParam = searchParams.get("sortBy") ?? "createdAt";
  const sortDirParam = searchParams.get("sortDir") ?? "desc";
  const pageParam = searchParams.get("page") ?? "1";
  const pageSizeParam = searchParams.get("pageSize") ?? "10";

  // Validate params
  const status = VALID_STATUSES.includes(statusParam as RecordingStatus | "all")
    ? (statusParam as RecordingStatus | "all")
    : "all";
  const sortField = VALID_SORT_FIELDS.includes(sortFieldParam as SortField)
    ? (sortFieldParam as SortField)
    : "createdAt";
  const sortDirection = VALID_SORT_DIRECTIONS.includes(
    sortDirParam as SortDirection,
  )
    ? (sortDirParam as SortDirection)
    : "desc";
  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(pageSizeParam, 10) || 10),
  );

  const filtered = filterRecordings(MOCK_RECORDINGS, query, status);
  const sorted = sortRecordings(filtered, sortField, sortDirection);
  const paginated = paginateRecordings(sorted, page, pageSize);

  return NextResponse.json(paginated);
}
