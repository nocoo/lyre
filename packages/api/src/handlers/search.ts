/**
 * Handlers for `/api/search` — global recording search for cmd palette.
 */

import { recordingsRepo, foldersRepo, tagsRepo } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import { json, unauthorized, type HandlerResponse } from "./http";

const MAX_RESULTS = 10;

export function searchHandler(
  ctx: RuntimeContext,
  query: string | null,
): HandlerResponse {
  if (!ctx.user) return unauthorized();

  const q = query?.trim();
  if (!q) return json({ results: [] });

  const { items } = recordingsRepo.findByUserId(ctx.user.id, {
    query: q,
    page: 1,
    pageSize: MAX_RESULTS,
    sortBy: "createdAt",
    sortDir: "desc",
  });

  const userFolders = foldersRepo.findByUserId(ctx.user.id);
  const folderMap = new Map(userFolders.map((f) => [f.id, f]));

  const results = items.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    aiSummary: row.aiSummary,
    folder: row.folderId ? folderMap.get(row.folderId) ?? null : null,
    resolvedTags: tagsRepo.findTagsForRecording(row.id),
    duration: row.duration,
    createdAt: row.createdAt,
  }));

  return json({ results });
}
