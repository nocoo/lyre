/**
 * Cloudflare Access JWT middleware.
 *
 * Resolves the current user from the `Cf-Access-Jwt-Assertion` header
 * issued by Cloudflare Access. Skipped entirely when:
 *
 * 1. `runtime.user` is already set (by `bearer-auth` running first), or
 * 2. `E2E_SKIP_AUTH === "true"` (in non-production) — in which case we
 *    synthesize a stable test user via `usersRepo.upsertByEmail`.
 *
 * Otherwise the assertion is verified end-to-end:
 *   - RS256 signature against the team's JWKS at
 *     `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
 *   - `iss === https://<team>.cloudflareaccess.com`
 *   - `aud` contains `CF_ACCESS_AUD` (the Application AUD tag)
 *   - `exp`/`nbf` are honored by `jwtVerify`
 *
 * The middleware is **fail-closed**: any failure (bad signature, missing
 * config, malformed token) leaves `runtime.user` null and the request
 * continues unauthenticated. Routes that require auth call
 * `unauthorized()` themselves, matching the bearer-auth contract.
 */

import { makeUsersRepo } from "@lyre/api/db/repositories";
import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Bindings, Variables } from "../bindings";

interface AccessPayload extends JWTPayload {
	email?: string;
	name?: string;
}

export interface AccessVerifyConfig {
	teamDomain: string;
	audience: string;
}

export type AccessVerifier = (
	jwt: string,
	cfg: AccessVerifyConfig,
) => Promise<AccessPayload | null>;

const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwks(teamDomain: string): JWTVerifyGetKey {
	let jwks = jwksCache.get(teamDomain);
	if (!jwks) {
		jwks = createRemoteJWKSet(
			new URL(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`),
		);
		jwksCache.set(teamDomain, jwks);
	}
	return jwks;
}

export const defaultAccessVerifier: AccessVerifier = async (jwt, cfg) => {
	try {
		const { payload } = await jwtVerify<AccessPayload>(jwt, getJwks(cfg.teamDomain), {
			issuer: `https://${cfg.teamDomain}.cloudflareaccess.com`,
			audience: cfg.audience,
			algorithms: ["RS256"],
		});
		return payload;
	} catch (err) {
		console.warn("[access-auth] JWT verification failed", err);
		return null;
	}
};

export interface AccessAuthOptions {
	verifier?: AccessVerifier;
}

export function accessAuth(options: AccessAuthOptions = {}): MiddlewareHandler<{
	Bindings: Bindings;
	Variables: Variables;
}> {
	const verify = options.verifier ?? defaultAccessVerifier;
	return async (c, next) => {
		const runtime = c.get("runtime");

		// Bearer already resolved a user — nothing to do.
		if (runtime.user) {
			await next();
			return;
		}

		// E2E bypass: synthesize a stable test user. Guarded by NODE_ENV so
		// the flag cannot be flipped in production to bypass auth.
		if (runtime.env.PLAYWRIGHT === "1" && runtime.env.NODE_ENV !== "production") {
			const users = makeUsersRepo(runtime.db);
			runtime.user = await users.upsertByEmail({
				id: "e2e-test-user",
				email: "e2e@test.com",
				name: "E2E Test User",
				avatarUrl: null,
			});
			await next();
			return;
		}

		const jwt = c.req.header("Cf-Access-Jwt-Assertion");
		if (jwt) {
			const teamDomain = runtime.env.CF_ACCESS_TEAM_DOMAIN;
			const audience = runtime.env.CF_ACCESS_AUD;
			if (!teamDomain || !audience) {
				console.warn(
					"[access-auth] CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not configured — rejecting Access assertion",
				);
			} else {
				const payload = await verify(jwt, { teamDomain, audience });
				if (payload?.email) {
					const email = payload.email;
					const name = payload.name ?? null;
					const id = `user-${btoa(email).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
					const users = makeUsersRepo(runtime.db);
					runtime.user = await users.upsertByEmail({
						id,
						email,
						name,
						avatarUrl: null,
					});
				}
			}
		}

		// No user resolved — DO NOT 401 here. Each route decides whether it
		// requires auth. `/api/live` is public; the rest of the handlers
		// call `unauthorized()` themselves when `ctx.user` is null.
		await next();
	};
}
