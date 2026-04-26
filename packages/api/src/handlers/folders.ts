/**
 * Handlers for `/api/folders` — folder CRUD.
 */

import { foldersRepo } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  notFound,
  unauthorized,
  type HandlerResponse,
} from "./http";

export function listFoldersHandler(ctx: RuntimeContext): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const folders = foldersRepo.findByUserId(ctx.user.id);
  return json({ items: folders });
}

export function createFolderHandler(
  ctx: RuntimeContext,
  body: { name?: string; icon?: string },
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  if (!body.name?.trim()) {
    return badRequest("Missing required field: name");
  }
  const trimmedIcon = body.icon?.trim();
  const folder = foldersRepo.create({
    id: crypto.randomUUID(),
    userId: ctx.user.id,
    name: body.name.trim(),
    ...(trimmedIcon ? { icon: trimmedIcon } : {}),
  });
  return json(folder, 201);
}

export function getFolderHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const folder = foldersRepo.findByIdAndUser(id, ctx.user.id);
  if (!folder) return notFound("Folder not found");
  return json(folder);
}

export function updateFolderHandler(
  ctx: RuntimeContext,
  id: string,
  body: { name?: string; icon?: string },
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const existing = foldersRepo.findByIdAndUser(id, ctx.user.id);
  if (!existing) return notFound("Folder not found");

  const updates: Parameters<typeof foldersRepo.update>[1] = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.icon !== undefined) updates.icon = body.icon.trim();
  const updated = foldersRepo.update(id, updates);
  if (!updated) return json({ error: "Failed to update folder" }, 500);
  return json(updated);
}

export function deleteFolderHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const existing = foldersRepo.findByIdAndUser(id, ctx.user.id);
  if (!existing) return notFound("Folder not found");
  foldersRepo.delete(id);
  return json({ deleted: true });
}
