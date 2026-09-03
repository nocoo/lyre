/**
 * Handler for `/api/me` — Access identity plus lizheng.blog avatar.
 */

import {
	type AuthorProfileFetcher,
	fetchAuthorProfile,
	shouldLookupAuthorProfile,
} from "../lib/author-profile";
import type { RuntimeContext } from "../runtime/context";
import { type HandlerResponse, json, unauthorized } from "./http";

export async function meHandler(
	ctx: RuntimeContext,
	fetchFn: AuthorProfileFetcher = fetch,
): Promise<HandlerResponse> {
	if (!ctx.user) return unauthorized();

	let name = ctx.user.name ?? ctx.user.email;
	let avatarUrl = ctx.user.avatarUrl;
	if (shouldLookupAuthorProfile(ctx.env)) {
		const profile = await fetchAuthorProfile(ctx.user.email, fetchFn);
		name = profile.name ?? name;
		avatarUrl = profile.avatar ?? avatarUrl;
	}

	return json({
		email: ctx.user.email,
		name,
		avatarUrl,
	});
}
