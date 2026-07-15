/**
 * CSRF / same-origin guard for cookie-authenticated browser writes.
 *
 * Cloudflare Access sets a session cookie that the browser sends with
 * `credentials: "include"` on every same-origin SPA call. Without an
 * application-level origin check, a malicious page could trick the
 * browser into POSTing to the Worker carrying those cookies (classic
 * CSRF). The Worker has no other layer that pins the request to its
 * own origin, so we enforce it here.
 *
 * Policy (only enforced for unsafe HTTP methods):
 *
 *   POST / PUT / PATCH / DELETE on `/api/*` must carry an
 *   `Origin` (or, if absent, a `Referer`) header whose origin matches
 *   the Worker's own request origin (or an entry in `PUBLIC_ORIGIN`).
 *
 * Explicit exemptions — these never look at Origin/Referer:
 *
 *   1. `Authorization: Bearer <token>` requests. These are the macOS
 *      app and any other bearer-token client; they do not rely on
 *      cookies, so CSRF does not apply.
 *   2. `/api/backy/pull` — documented machine-to-machine webhook
 *      authenticated by a per-user pull-key inside the handler, called
 *      by a remote Backy instance that has no SPA origin to advertise.
 *
 * Safe methods (GET, HEAD, OPTIONS) and any non-`/api/*` path are
 * untouched — the middleware is mounted under `/api/*` and short-circuits
 * for safe methods.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "../bindings";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Paths exempt from same-origin enforcement. Match exact pathname.
const EXEMPT_PATHS = new Set(["/api/backy/pull"]);

function parseOrigin(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return `${u.protocol}//${u.host}`;
	} catch {
		return null;
	}
}

function allowedOrigins(env: Bindings, requestUrl: string): Set<string> {
	const allowed = new Set<string>();
	const self = parseOrigin(requestUrl);
	if (self) allowed.add(self);
	const configured = env.PUBLIC_ORIGIN;
	if (configured) {
		for (const raw of configured.split(",")) {
			const o = parseOrigin(raw.trim());
			if (o) allowed.add(o);
		}
	}
	return allowed;
}

export function csrfGuard(): MiddlewareHandler<{
	Bindings: Bindings;
	Variables: Variables;
}> {
	return async (c, next) => {
		const method = c.req.method.toUpperCase();
		if (!UNSAFE_METHODS.has(method)) {
			await next();
			return;
		}

		// Bearer-token clients (macOS app, scripted callers) — exempt.
		const auth = c.req.header("Authorization");
		if (auth?.startsWith("Bearer ")) {
			await next();
			return;
		}

		// Documented machine-to-machine endpoints — exempt.
		const url = new URL(c.req.url);
		if (EXEMPT_PATHS.has(url.pathname)) {
			await next();
			return;
		}

		const allowed = allowedOrigins(c.env, c.req.url);

		const originHeader = parseOrigin(c.req.header("Origin"));
		if (originHeader) {
			if (!allowed.has(originHeader)) {
				return c.json({ error: "forbidden_origin" }, 403);
			}
			await next();
			return;
		}

		// No Origin — fall back to Referer (older browsers / some Safari WebViews
		// omit Origin on same-site POSTs).
		const refererHeader = parseOrigin(c.req.header("Referer"));
		if (refererHeader) {
			if (!allowed.has(refererHeader)) {
				return c.json({ error: "forbidden_origin" }, 403);
			}
			await next();
			return;
		}

		return c.json({ error: "missing_origin" }, 403);
	};
}
