/**
 * Handlers for `/api/tags` — tag CRUD.
 */

import { tagsRepo } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  notFound,
  unauthorized,
  type HandlerResponse,
} from "./http";

export function listTagsHandler(ctx: RuntimeContext): HandlerResponse {
  if (!ctx.user) return unauthorized();
  return json({ items: tagsRepo.findByUserId(ctx.user.id) });
}

export function createTagHandler(
  ctx: RuntimeContext,
  body: { name?: string },
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  if (!body.name?.trim()) return badRequest("Missing required field: name");

  const name = body.name.trim();
  const existing = tagsRepo.findByNameAndUser(name, ctx.user.id);
  if (existing) {
    return json({ error: "Tag already exists", tag: existing }, 409);
  }
  const tag = tagsRepo.create({
    id: crypto.randomUUID(),
    userId: ctx.user.id,
    name,
  });
  return json(tag, 201);
}

export function updateTagHandler(
  ctx: RuntimeContext,
  id: string,
  body: { name?: string },
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const tag = tagsRepo.findByIdAndUser(id, ctx.user.id);
  if (!tag) return notFound("Tag not found");

  const name = body.name?.trim();
  if (!name) return badRequest("Name is required");

  const existing = tagsRepo.findByNameAndUser(name, ctx.user.id);
  if (existing && existing.id !== id) {
    return json({ error: "Tag name already exists" }, 409);
  }
  const updated = tagsRepo.update(id, { name });
  return json(updated);
}

export function deleteTagHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const tag = tagsRepo.findByIdAndUser(id, ctx.user.id);
  if (!tag) return notFound("Tag not found");
  tagsRepo.delete(id);
  return json({ deleted: true });
}
