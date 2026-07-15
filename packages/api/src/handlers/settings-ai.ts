/**
 * Handlers for `/api/settings/ai` and `/api/settings/ai/test`.
 */

import type { AuthType } from "@nocoo/next-ai";
import { generateText } from "ai";
import { makeRepos, type SettingsRepo } from "../db/repositories";
import type { RuntimeContext } from "../runtime/context";
import {
	type AiProvider,
	createAiModel,
	isValidProvider,
	resolveAiConfig,
	type SdkType,
} from "../services/ai";
import { badRequest, type HandlerResponse, json, unauthorized } from "./http";

interface AiSettings {
	provider: AiProvider | "";
	apiKey: string;
	model: string;
	autoSummarize: boolean;
	baseURL: string;
	sdkType: SdkType | "";
	authType: AuthType | "";
}

async function readAiSettings(settings: SettingsRepo, userId: string): Promise<AiSettings> {
	const all = await settings.findByUserId(userId);
	const map = new Map(all.map((s) => [s.key, s.value]));
	const rawAuth = map.get("ai.authType") ?? "";
	const authType: AuthType | "" = rawAuth === "bearer" || rawAuth === "apiKey" ? rawAuth : "";
	return {
		provider: (map.get("ai.provider") ?? "") as AiProvider | "",
		apiKey: map.get("ai.apiKey") ?? "",
		model: map.get("ai.model") ?? "",
		autoSummarize: map.get("ai.autoSummarize") === "true",
		baseURL: map.get("ai.baseURL") ?? "",
		sdkType: (map.get("ai.sdkType") ?? "") as SdkType | "",
		authType,
	};
}

function maskApiKey(key: string): string {
	if (!key) return "";
	return `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export async function getAiSettingsHandler(ctx: RuntimeContext): Promise<HandlerResponse> {
	if (!ctx.user) return unauthorized();
	const { settings } = makeRepos(ctx.db);
	const aiSettings = await readAiSettings(settings, ctx.user.id);
	return json({
		...aiSettings,
		apiKey: maskApiKey(aiSettings.apiKey),
		hasApiKey: !!aiSettings.apiKey,
	});
}

export interface UpdateAiSettingsInput {
	provider?: string;
	apiKey?: string;
	model?: string;
	autoSummarize?: boolean;
	baseURL?: string;
	sdkType?: string;
	authType?: string;
}

export async function updateAiSettingsHandler(
	ctx: RuntimeContext,
	body: UpdateAiSettingsInput,
): Promise<HandlerResponse> {
	if (!ctx.user) return unauthorized();
	if (body.provider !== undefined && body.provider !== "") {
		if (!isValidProvider(body.provider)) {
			return badRequest(`Invalid provider: ${body.provider}`);
		}
	}
	if (body.sdkType !== undefined && body.sdkType !== "") {
		if (body.sdkType !== "openai" && body.sdkType !== "anthropic") {
			return badRequest(`Invalid SDK type: ${body.sdkType}`);
		}
	}
	if (body.authType !== undefined && body.authType !== "") {
		if (body.authType !== "apiKey" && body.authType !== "bearer") {
			return badRequest(`Invalid auth type: ${body.authType}`);
		}
	}
	const userId = ctx.user.id;
	const { settings } = makeRepos(ctx.db);
	if (body.provider !== undefined) await settings.upsert(userId, "ai.provider", body.provider);
	if (body.apiKey !== undefined) await settings.upsert(userId, "ai.apiKey", body.apiKey);
	if (body.model !== undefined) await settings.upsert(userId, "ai.model", body.model);
	if (body.autoSummarize !== undefined)
		await settings.upsert(userId, "ai.autoSummarize", String(body.autoSummarize));
	if (body.baseURL !== undefined) await settings.upsert(userId, "ai.baseURL", body.baseURL);
	if (body.sdkType !== undefined) await settings.upsert(userId, "ai.sdkType", body.sdkType);
	if (body.authType !== undefined) await settings.upsert(userId, "ai.authType", body.authType);

	const updated = await readAiSettings(settings, userId);
	return json({
		...updated,
		apiKey: maskApiKey(updated.apiKey),
		hasApiKey: !!updated.apiKey,
	});
}

export async function testAiSettingsHandler(ctx: RuntimeContext): Promise<HandlerResponse> {
	if (!ctx.user) return unauthorized();
	const { settings } = makeRepos(ctx.db);
	const all = await settings.findByUserId(ctx.user.id);
	const map = new Map(all.map((s) => [s.key, s.value]));
	const provider = map.get("ai.provider") ?? "";
	const apiKey = map.get("ai.apiKey") ?? "";
	const model = map.get("ai.model") ?? "";
	const baseURL = map.get("ai.baseURL") ?? "";
	const sdkType = map.get("ai.sdkType") ?? "";
	const rawAuth = map.get("ai.authType") ?? "";
	const authType: AuthType | undefined =
		rawAuth === "bearer" || rawAuth === "apiKey" ? rawAuth : undefined;

	if (!provider || !apiKey) {
		return badRequest("AI provider and API key must be configured first");
	}

	try {
		const config = resolveAiConfig({
			provider: provider as AiProvider,
			apiKey,
			model,
			...(baseURL ? { baseURL } : {}),
			...(sdkType ? { sdkType: sdkType as SdkType } : {}),
			...(authType ? { authType } : {}),
		});
		const client = createAiModel(config);
		const { text } = await generateText({
			model: client,
			prompt: "Reply with exactly: OK",
			maxOutputTokens: 10,
		});
		return json({
			success: true,
			response: text.trim(),
			model: config.model,
			provider: config.provider,
		});
	} catch (err) {
		// Surface the upstream provider's status + message so the client sees
		// "401 Authentication failed" instead of a generic 502 (which the
		// edge can render as HTML and break res.json() with 'Unexpected token <').
		type UpstreamError = Error & {
			statusCode?: number;
			responseBody?: string;
			url?: string;
		};
		const e = err as UpstreamError;
		const statusCode = typeof e.statusCode === "number" ? e.statusCode : 502;
		const baseMessage = e.message ?? "Unknown error";
		let detail = baseMessage;
		if (e.responseBody) {
			try {
				const parsed = JSON.parse(e.responseBody) as {
					error?: { message?: string } | string;
					message?: string;
				};
				const inner =
					typeof parsed.error === "string"
						? parsed.error
						: (parsed.error?.message ?? parsed.message);
				if (inner) detail = inner;
			} catch {
				// responseBody not JSON — keep baseMessage
			}
		}
		return json(
			{
				success: false,
				error: e.url ? `${detail} (upstream: ${e.url})` : detail,
			},
			statusCode,
		);
	}
}
