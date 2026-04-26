/**
 * Handlers for `/api/settings/tokens` and `/api/settings/tokens/[id]`.
 */

import { makeRepos } from "../db/repositories";
import { hashToken } from "../lib/api-auth";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  notFound,
  unauthorized,
  type HandlerResponse,
} from "./http";

export async function listTokensHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { deviceTokens } = makeRepos(ctx.db);
  const tokens = await deviceTokens.findByUserId(ctx.user.id);
  const items = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
  }));
  return json({ items });
}

export async function createTokenHandler(
  ctx: RuntimeContext,
  body: { name?: string },
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const name = body.name?.trim();
  if (!name) return badRequest("Token name is required");
  if (name.length > 100) {
    return badRequest("Token name must be 100 characters or less");
  }
  const { deviceTokens } = makeRepos(ctx.db);
  const rawBytes = crypto.getRandomValues(new Uint8Array(48));
  const rawToken = `lyre_${Buffer.from(rawBytes).toString("base64url")}`;
  const tokenHash = hashToken(rawToken);
  const id = crypto.randomUUID();
  const record = await deviceTokens.create({
    id,
    userId: ctx.user.id,
    name,
    tokenHash,
  });
  return json(
    {
      id: record.id,
      name: record.name,
      token: rawToken,
      createdAt: record.createdAt,
    },
    201,
  );
}

export async function deleteTokenHandler(
  ctx: RuntimeContext,
  id: string,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { deviceTokens } = makeRepos(ctx.db);
  const deleted = await deviceTokens.deleteByIdAndUser(id, ctx.user.id);
  if (!deleted) return notFound("Token not found");
  return json({ deleted: true });
}
