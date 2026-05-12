import { makeRepos } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import { json, unauthorized, type HandlerResponse } from "./http";

const DEFAULT_ASR_MODEL = "qwen3-asr-flash-filetrans";

interface AsrSettings {
  model: string;
}

async function readAsrSettings(
  settings: ReturnType<typeof makeRepos>["settings"],
  userId: string,
): Promise<AsrSettings> {
  const all = await settings.findByUserId(userId);
  const map = new Map(all.map((s) => [s.key, s.value]));
  return {
    model: map.get("asr.model") ?? DEFAULT_ASR_MODEL,
  };
}

export async function getAsrSettingsHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { settings } = makeRepos(ctx.db);
  return json(await readAsrSettings(settings, ctx.user.id));
}

export interface UpdateAsrSettingsInput {
  model?: string;
}

export async function updateAsrSettingsHandler(
  ctx: RuntimeContext,
  body: UpdateAsrSettingsInput,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const userId = ctx.user.id;
  const { settings } = makeRepos(ctx.db);

  if (body.model !== undefined)
    await settings.upsert(userId, "asr.model", body.model);

  return json(await readAsrSettings(settings, userId));
}
