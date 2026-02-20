import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo } from "@/db/repositories";
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

  const { items, total } = recordingsRepo.findByUserId(user.id, {
    status: status === "all" ? undefined : (status as RecordingStatus),
    query: query || undefined,
    sortBy,
    sortDir,
    page,
    pageSize,
  });

  // Convert DB rows to domain shape (parse tags)
  const recordings = items.map((row) => ({
    ...row,
    tags: recordingsRepo.parseTags(row.tags),
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
  };

  if (!body.title || !body.fileName || !body.ossKey) {
    return NextResponse.json(
      { error: "Missing required fields: title, fileName, ossKey" },
      { status: 400 },
    );
  }

  // Use client-provided id (from presign) or generate a new one
  const id = body.id ?? crypto.randomUUID();

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
  });

  return NextResponse.json(
    { ...recording, tags: recordingsRepo.parseTags(recording.tags) },
    { status: 201 },
  );
}
