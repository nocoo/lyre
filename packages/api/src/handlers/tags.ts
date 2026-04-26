/**
 * Handlers for `/api/tags` — tag CRUD.
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

export function listTagsHandler(ctx: RuntimeContext): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const { tags } = makeRepos(ctx.db);
  return json({ items: tags.findByUserId(ctx.user.id) });
}

export function createTagHandler(
  ctx: RuntimeContext,
  body: { name?: string },
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  if (!body.name?.trim()) return badRequest("Missing required field: name");

  const { tags } = makeRepos(ctx.db);
  const name = body.name.trim();
  const existing = tags.findByNameAndUser(name, ctx.user.id);
  if (existing) {
    return json({ error: "Tag already exists", tag: existing }, 409);
  }
  const tag = tags.create({
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
  const { tags } = makeRepos(ctx.db);
  const tag = tags.findByIdAndUser(id, ctx.user.id);
  if (!tag) return notFound("Tag not found");

  const name = body.name?.trim();
  if (!name) return badRequest("Name is required");

  const existing = tags.findByNameAndUser(name, ctx.user.id);
  if (existing && existing.id !== id) {
    return json({ error: "Tag name already exists" }, 409);
  }
  const updated = tags.update(id, { name });
  return json(updated);
}

export function deleteTagHandler(
  ctx: RuntimeContext,
  id: string,
): HandlerResponse {
  if (!ctx.user) return unauthorized();
  const { tags } = makeRepos(ctx.db);
  const tag = tags.findByIdAndUser(id, ctx.user.id);
  if (!tag) return notFound("Tag not found");
  tags.delete(id);
  return json({ deleted: true });
}
