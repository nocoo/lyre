import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo, foldersRepo, tagsRepo } from "@/db/repositories";
import type { RecordingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_SORT_FIELDS = ["createdAt", "title", "duration", "fileSize"] as const;
const VALID_SORT_DIRECTIONS = ["asc", "desc"] as const;
const VALID_STATUSES = [
  "all",
  "uploaded",
  "transcribing",
  "completed",
  "failed",
] as const;

type SortField = (typeof VALID_SORT_FIELDS)[number];
type SortDirection = (typeof VALID_SORT_DIRECTIONS)[number];

function includes<T extends string>(arr: readonly T[], val: string): val is T {
  return (arr as readonly string[]).includes(val);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;

  const query = searchParams.get("q") ?? "";
  const statusParam = searchParams.get("status") ?? "all";
  const sortFieldParam = searchParams.get("sortBy") ?? "createdAt";
  const sortDirParam = searchParams.get("sortDir") ?? "desc";
  const pageParam = searchParams.get("page") ?? "1";
  const pageSizeParam = searchParams.get("pageSize") ?? "10";
  const folderParam = searchParams.get("folderId"); // null = not filtering, "unfiled" = no folder, otherwise = folder id

  // Validate params
  const status = includes(VALID_STATUSES, statusParam) ? statusParam : "all";
  const sortBy: SortField = includes(VALID_SORT_FIELDS, sortFieldParam)
    ? sortFieldParam
    : "createdAt";
  const sortDir: SortDirection = includes(VALID_SORT_DIRECTIONS, sortDirParam)
    ? sortDirParam
    : "desc";
  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeParam, 10) || 10));

  // Build filter options, omitting undefined to satisfy exactOptionalPropertyTypes
  const filterStatus = status === "all" ? undefined : (status as RecordingStatus);
  const filterQuery = query || undefined;

  const opts: Parameters<typeof recordingsRepo.findByUserId>[1] = {
    sortBy,
    sortDir,
    page,
    pageSize,
  };
  if (filterStatus !== undefined) opts.status = filterStatus;
  if (filterQuery !== undefined) opts.query = filterQuery;
  if (folderParam === "unfiled") {
    opts.folderId = null;
  } else if (folderParam) {
    opts.folderId = folderParam;
  }

  const { items, total } = recordingsRepo.findByUserId(user.id, opts);

  // Pre-fetch all user folders for efficient lookup
  const userFolders = foldersRepo.findByUserId(user.id);
  const folderMap = new Map(userFolders.map((f) => [f.id, f]));

  // Convert DB rows to enriched list items (with folder + resolved tags)
  const recordings = items.map((row) => ({
    ...row,
    tags: recordingsRepo.parseTags(row.tags),
    folder: row.folderId ? folderMap.get(row.folderId) ?? null : null,
    resolvedTags: tagsRepo.findTagsForRecording(row.id),
  }));

  const totalPages = Math.ceil(total / pageSize);

  return NextResponse.json({
    items: recordings,
    total,
    page,
    pageSize,
    totalPages,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id?: string;
    title?: string;
    description?: string;
    fileName?: string;
    fileSize?: number;
    duration?: number;
    format?: string;
    sampleRate?: number;
    ossKey?: string;
    tags?: string[];
    tagIds?: string[];
    recordedAt?: number;
    folderId?: string | null;
  };

  if (!body.title || !body.fileName || !body.ossKey) {
    return NextResponse.json(
      { error: "Missing required fields: title, fileName, ossKey" },
      { status: 400 },
    );
  }

  // Use client-provided id (from presign) or generate a new one
  const id = body.id ?? crypto.randomUUID();

  try {
    const recording = recordingsRepo.create({
      id,
      userId: user.id,
      title: body.title,
      description: body.description ?? null,
      fileName: body.fileName,
      fileSize: body.fileSize ?? null,
      duration: body.duration ?? null,
      format: body.format ?? null,
      sampleRate: body.sampleRate ?? null,
      ossKey: body.ossKey,
      tags: body.tags ?? [],
      status: "uploaded",
      recordedAt: body.recordedAt ?? null,
      folderId: body.folderId ?? null,
    });

    // Write tag associations to the normalized join table
    const tagIds = body.tagIds ?? body.tags ?? [];
    if (tagIds.length > 0) {
      tagsRepo.setTagsForRecording(recording.id, tagIds);
    }

    return NextResponse.json(
      { ...recording, tags: recordingsRepo.parseTags(recording.tags) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create recording:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create recording: ${message}` },
      { status: 500 },
    );
  }
}
