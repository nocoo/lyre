import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { recordingsRepo, foldersRepo, tagsRepo } from "@/db/repositories";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;

/**
 * Global search endpoint for command palette.
 * Searches recordings by title, description, aiSummary, and tags.
 * Returns lightweight results suitable for quick navigation.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const { items } = recordingsRepo.findByUserId(user.id, {
    query,
    page: 1,
    pageSize: MAX_RESULTS,
    sortBy: "createdAt",
    sortDir: "desc",
  });

  // Pre-fetch all user folders for efficient lookup
  const userFolders = foldersRepo.findByUserId(user.id);
  const folderMap = new Map(userFolders.map((f) => [f.id, f]));

  const results = items.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    aiSummary: row.aiSummary,
    tags: recordingsRepo.parseTags(row.tags),
    folder: row.folderId ? folderMap.get(row.folderId) ?? null : null,
    resolvedTags: tagsRepo.findTagsForRecording(row.id),
    duration: row.duration,
    createdAt: row.createdAt,
  }));

  return NextResponse.json({ results });
}
