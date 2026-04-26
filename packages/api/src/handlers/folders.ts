/**
 * Handlers for `/api/folders` — folder CRUD.
 */

import { makeRepos } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  notFound,
  unauthorized,
  type HandlerResponse,
} from "./http";

export async function listFoldersHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { folders } = makeRepos(ctx.db);
  return json({ items: await folders.findByUserId(ctx.user.id) });
}

export async function createFolderHandler(
  ctx: RuntimeContext,
  body: { name?: string; icon?: string },
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  if (!body.name?.trim()) {
    return badRequest("Missing required field: name");
  }
  const { folders } = makeRepos(ctx.db);
  const trimmedIcon = body.icon?.trim();
  const folder = await folders.create({
    id: crypto.randomUUID(),
    userId: ctx.user.id,
    name: body.name.trim(),
    ...(trimmedIcon ? { icon: trimmedIcon } : {}),
  });
  return json(folder, 201);
}

export async function getFolderHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { folders } = makeRepos(ctx.db);
  const folder = await folders.findByIdAndUser(id, ctx.user.id);
  if (!folder) return notFound("Folder not found");
  return json(folder);
}

export async function updateFolderHandler(
  ctx: RuntimeContext,
  id: string,
  body: { name?: string; icon?: string },
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { folders } = makeRepos(ctx.db);
  const existing = await folders.findByIdAndUser(id, ctx.user.id);
  if (!existing) return notFound("Folder not found");

  const updates: Parameters<typeof folders.update>[1] = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.icon !== undefined) updates.icon = body.icon.trim();
  const updated = await folders.update(id, updates);
  if (!updated) return json({ error: "Failed to update folder" }, 500);
  return json(updated);
}

export async function deleteFolderHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { folders } = makeRepos(ctx.db);
  const existing = await folders.findByIdAndUser(id, ctx.user.id);
  if (!existing) return notFound("Folder not found");
  await folders.delete(id);
  return json({ deleted: true });
}
