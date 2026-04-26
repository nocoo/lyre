/**
 * Handlers for `/api/search` — global recording search for cmd palette.
 */

import { makeRepos } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import { json, unauthorized, type HandlerResponse } from "./http";

const MAX_RESULTS = 10;

export async function searchHandler(
  ctx: RuntimeContext,
  query: string | null,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();

  const q = query?.trim();
  if (!q) return json({ results: [] });

  const { recordings, folders, tags } = makeRepos(ctx.db);
  const { items } = await recordings.findByUserId(ctx.user.id, {
    query: q,
    page: 1,
    pageSize: MAX_RESULTS,
    sortBy: "createdAt",
    sortDir: "desc",
  });

  const userFolders = await folders.findByUserId(ctx.user.id);
  const folderMap = new Map(userFolders.map((f) => [f.id, f]));

  const results = await Promise.all(
    items.map(async (row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      aiSummary: row.aiSummary,
      folder: row.folderId ? folderMap.get(row.folderId) ?? null : null,
      resolvedTags: await tags.findTagsForRecording(row.id),
      duration: row.duration,
      createdAt: row.createdAt,
    })),
  );

  return json({ results });
}
