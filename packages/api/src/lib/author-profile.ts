/**
 * lizheng.blog author profile lookup.
 *
 * Query by SHA-256(email) only — never put the email on the wire.
 */

export const AUTHOR_PROFILE_URL = "https://lizheng.blog/api/authors/profile";
export const AUTHOR_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

export type AuthorProfile = {
	name: string | null;
	avatar: string | null;
};

export type AuthorProfileFetcher = (url: string, init?: RequestInit) => Promise<Response>;

const EMPTY: AuthorProfile = { name: null, avatar: null };
const cache = new Map<string, { profile: AuthorProfile; exp: number }>();

export function resetAuthorProfileCache(): void {
	cache.clear();
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export async function hashEmail(email: string): Promise<string> {
	const bytes = new TextEncoder().encode(normalizeEmail(email));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseAuthorProfile(data: unknown): AuthorProfile {
	if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY;
	const rec = data as Record<string, unknown>;
	const name = typeof rec.name === "string" && rec.name.length > 0 ? rec.name : null;
	const avatar = typeof rec.avatar === "string" && rec.avatar.length > 0 ? rec.avatar : null;
	return { name, avatar };
}

export function shouldLookupAuthorProfile(env: {
	NODE_ENV?: string | undefined;
	PLAYWRIGHT?: string | undefined;
}): boolean {
	if (env.PLAYWRIGHT === "1") return false;
	return env.NODE_ENV === "production" || env.NODE_ENV === "development";
}

export async function fetchAuthorProfile(
	email: string,
	fetchFn: AuthorProfileFetcher = fetch,
): Promise<AuthorProfile> {
	const hash = await hashEmail(email);
	const now = Date.now();
	const cached = cache.get(hash);
	if (cached && cached.exp > now) return cached.profile;

	const url = `${AUTHOR_PROFILE_URL}?hash=${encodeURIComponent(hash)}`;
	try {
		const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) return EMPTY;
		const profile = parseAuthorProfile(await res.json());
		cache.set(hash, { profile, exp: now + AUTHOR_PROFILE_CACHE_TTL_MS });
		return profile;
	} catch {
		return EMPTY;
	}
}
