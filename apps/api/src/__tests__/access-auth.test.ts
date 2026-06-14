/**
 * Tests for the Cloudflare Access JWT middleware.
 *
 * Focus is on the auth decision logic: signature/issuer/audience
 * failures must NOT populate `runtime.user`, while a valid assertion
 * (mocked verifier) must upsert + set the user. The default verifier
 * itself is exercised against a locally-generated RS256 key and a
 * stub JWKS resolver, to lock down the "trust the header" regression.
 */

import { describe, expect, test, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  createLocalJWKSet,
  type JWK,
} from "jose";

import type { Bindings, Variables } from "../bindings";
import { accessAuth, type AccessVerifier } from "../middleware/access-auth";
import { setupAnonCtx } from "../../../../packages/api/src/__tests__/_fixtures/runtime-context";
import { makeUsersRepo } from "../../../../packages/api/src/db/repositories";
import type { LyreEnv } from "../../../../packages/api/src/runtime/env";

const TEAM = "lyre-test";
const AUD = "test-aud-tag";

function buildApp(envOverrides: Partial<LyreEnv>, verifier?: AccessVerifier) {
  const ctx = setupAnonCtx();
  ctx.env = { ...ctx.env, ...envOverrides };
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("runtime", ctx);
    await next();
  });
  app.use("*", accessAuth(verifier ? { verifier } : {}));
  app.get("/probe", (c) =>
    c.json({
      email: ctx.user?.email ?? null,
      id: ctx.user?.id ?? null,
    }),
  );
  return { app, ctx };
}

describe("accessAuth — verifier integration", () => {
  test("valid assertion populates runtime.user via upsertByEmail", async () => {
    const verifier: AccessVerifier = async () => ({
      email: "alice@example.com",
      name: "Alice",
    });
    const { app, ctx } = buildApp(
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      verifier,
    );
    const res = await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "any.thing.here" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string | null };
    expect(body.email).toBe("alice@example.com");
    expect(ctx.user?.email).toBe("alice@example.com");
  });

  test("verifier rejection leaves runtime.user null", async () => {
    const verifier: AccessVerifier = async () => null;
    const { app, ctx } = buildApp(
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      verifier,
    );
    const res = await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "forged.payload.sig" },
    });
    expect(res.status).toBe(200);
    expect(ctx.user).toBeNull();
  });

  test("missing CF_ACCESS_TEAM_DOMAIN rejects the assertion (fail-closed)", async () => {
    let verifierCalled = false;
    const verifier: AccessVerifier = async () => {
      verifierCalled = true;
      return { email: "should-not@reach.me" };
    };
    const { app, ctx } = buildApp({ CF_ACCESS_AUD: AUD }, verifier);
    const res = await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "x.y.z" },
    });
    expect(res.status).toBe(200);
    expect(verifierCalled).toBe(false);
    expect(ctx.user).toBeNull();
  });

  test("missing CF_ACCESS_AUD rejects the assertion (fail-closed)", async () => {
    let verifierCalled = false;
    const verifier: AccessVerifier = async () => {
      verifierCalled = true;
      return { email: "should-not@reach.me" };
    };
    const { app, ctx } = buildApp({ CF_ACCESS_TEAM_DOMAIN: TEAM }, verifier);
    const res = await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "x.y.z" },
    });
    expect(res.status).toBe(200);
    expect(verifierCalled).toBe(false);
    expect(ctx.user).toBeNull();
  });

  test("no Cf-Access-Jwt-Assertion header leaves runtime.user null", async () => {
    const { app, ctx } = buildApp(
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      async () => ({ email: "ghost@example.com" }),
    );
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(ctx.user).toBeNull();
  });

  test("payload without email is ignored", async () => {
    const verifier: AccessVerifier = async () => ({ name: "Nameless" });
    const { app, ctx } = buildApp(
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      verifier,
    );
    const res = await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "x.y.z" },
    });
    expect(res.status).toBe(200);
    expect(ctx.user).toBeNull();
  });

  test("runs upsertByEmail (idempotent across requests)", async () => {
    const verifier: AccessVerifier = async () => ({
      email: "bob@example.com",
      name: "Bob",
    });
    const { app, ctx } = buildApp(
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      verifier,
    );
    await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "x.y.z" },
    });
    const firstId: string | undefined = ctx.user?.id;
    expect(firstId).toBeTruthy();
    ctx.user = null;
    await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "x.y.z" },
    });
    // Re-fetch via repo to avoid TS narrowing the in-place mutation.
    const reloaded = await makeUsersRepo(ctx.db).findByEmail("bob@example.com");
    expect(reloaded?.id).toBe(firstId);

    const users = makeUsersRepo(ctx.db);
    const found = await users.findByEmail("bob@example.com");
    expect(found?.email).toBe("bob@example.com");
  });
});

describe("accessAuth — bypass and ordering", () => {
  test("skips verifier when runtime.user is already set", async () => {
    let verifierCalled = false;
    const verifier: AccessVerifier = async () => {
      verifierCalled = true;
      return { email: "x@example.com" };
    };
    const ctx = setupAnonCtx();
    ctx.user = {
      id: "preset",
      email: "preset@example.com",
      name: "Preset",
      avatarUrl: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("runtime", ctx);
      await next();
    });
    app.use("*", accessAuth({ verifier }));
    app.get("/probe", (c) => c.json({ ok: true }));
    const res = await app.request("/probe", {
      headers: { "Cf-Access-Jwt-Assertion": "anything" },
    });
    expect(res.status).toBe(200);
    expect(verifierCalled).toBe(false);
    expect(ctx.user?.email).toBe("preset@example.com");
  });

  test("E2E_SKIP_AUTH bypass only fires when NODE_ENV !== production", async () => {
    const ctx = setupAnonCtx();
    ctx.env.PLAYWRIGHT = "1";
    ctx.env.NODE_ENV = "test";
    let verifierCalled = false;
    const verifier: AccessVerifier = async () => {
      verifierCalled = true;
      return null;
    };
    const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("runtime", ctx);
      await next();
    });
    app.use("*", accessAuth({ verifier }));
    app.get("/probe", (c) => c.json({ ok: true }));
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(verifierCalled).toBe(false);
    expect(ctx.user?.email).toBe("e2e@test.com");
  });

  test("E2E_SKIP_AUTH bypass is ignored in production", async () => {
    const ctx = setupAnonCtx();
    ctx.env.PLAYWRIGHT = "1";
    ctx.env.NODE_ENV = "production";
    const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("runtime", ctx);
      await next();
    });
    app.use("*", accessAuth());
    app.get("/probe", (c) => c.json({ ok: true }));
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(ctx.user).toBeNull();
  });
});

describe("defaultAccessVerifier — real RS256 verification", () => {
  // The default verifier closes over a `createRemoteJWKSet` that fetches
  // from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` and
  // caches the resolver per teamDomain at module scope. Every test
  // therefore uses a UNIQUE teamDomain so each gets a fresh JWKS cache
  // entry whose published key matches that test's signing key. Sharing
  // one teamDomain across tests would let the first test's cached JWKS
  // reject later tests' tokens on signature mismatch before the
  // issuer/audience checks ever run — which would mean the wrong-issuer
  // and wrong-audience regressions silently stop covering those claims.
  const AUDIENCE = "audience-tag-xyz";
  let originalFetch: typeof globalThis.fetch;
  let teamCounter = 0;

  type Harness = {
    teamDomain: string;
    issuer: string;
    privateKey: CryptoKey;
    publicJwk: JWK;
    fetchUrls: string[];
  };

  async function newHarness(): Promise<Harness> {
    teamCounter += 1;
    const teamDomain = `lyre-jwks-test-${teamCounter}-${Date.now()}`;
    const issuer = `https://${teamDomain}.cloudflareaccess.com`;
    const certsUrl = `${issuer}/cdn-cgi/access/certs`;
    const kp = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(kp.publicKey);
    jwk.kid = "test-kid";
    jwk.alg = "RS256";
    jwk.use = "sig";
    const body = JSON.stringify({ keys: [jwk] });

    const fetchUrls: string[] = [];
    const prior = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchUrls.push(url);
      if (url === certsUrl) {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Fall through to the previously installed fetch so we don't
      // accidentally swallow unrelated calls in this process.
      return prior(input as RequestInfo);
    }) as typeof globalThis.fetch;

    return { teamDomain, issuer, privateKey: kp.privateKey, publicJwk: jwk, fetchUrls };
  }

  function signWith(
    h: Harness,
    overrides: { issuer?: string; audience?: string; email?: string; expiresIn?: string } = {},
  ) {
    return new SignJWT({ email: overrides.email ?? "verified@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? h.issuer)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(h.privateKey);
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  function restoreFetch() {
    globalThis.fetch = originalFetch;
  }

  test("valid RS256 assertion populates user", async () => {
    const h = await newHarness();
    try {
      const jwt = await signWith(h);
      const { defaultAccessVerifier } = await import("../middleware/access-auth");
      const payload = await defaultAccessVerifier(jwt, {
        teamDomain: h.teamDomain,
        audience: AUDIENCE,
      });
      expect(payload?.email).toBe("verified@example.com");
    } finally {
      restoreFetch();
    }
  });

  test("forged token (different key, same kid) is rejected on signature", async () => {
    const h = await newHarness();
    try {
      const otherKp = await generateKeyPair("RS256", { extractable: true });
      const forged = await new SignJWT({ email: "attacker@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
        .setIssuedAt()
        .setIssuer(h.issuer)
        .setAudience(AUDIENCE)
        .setExpirationTime("5m")
        .sign(otherKp.privateKey);
      const { defaultAccessVerifier } = await import("../middleware/access-auth");
      const payload = await defaultAccessVerifier(forged, {
        teamDomain: h.teamDomain,
        audience: AUDIENCE,
      });
      expect(payload).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("wrong issuer is rejected (claim check, not signature)", async () => {
    const h = await newHarness();
    try {
      // Token is signed with this harness's real private key — so the
      // signature WILL verify against the cached JWKS for h.teamDomain.
      // The rejection must therefore come from the issuer claim check.
      const jwt = await signWith(h, {
        issuer: "https://attacker.cloudflareaccess.com",
      });
      // Sanity: without the issuer constraint the same JWT verifies
      // fine against the published JWKS — proves the rejection below is
      // the issuer check, not a signature mismatch hidden by the cache.
      const localJwks = createLocalJWKSet({ keys: [h.publicJwk] });
      const sanity = await jwtVerify(jwt, localJwks, {
        audience: AUDIENCE,
        algorithms: ["RS256"],
      });
      expect(sanity.payload.iss).toBe("https://attacker.cloudflareaccess.com");

      const { defaultAccessVerifier } = await import("../middleware/access-auth");
      const payload = await defaultAccessVerifier(jwt, {
        teamDomain: h.teamDomain,
        audience: AUDIENCE,
      });
      expect(payload).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("wrong audience is rejected (claim check, not signature)", async () => {
    const h = await newHarness();
    try {
      // Same logic as wrong-issuer: real signature, mutated claim. The
      // rejection must come from the audience check, not signature
      // mismatch.
      const jwt = await signWith(h, { audience: "some-other-app" });
      // Sanity: without the audience constraint the JWT verifies
      // against the published JWKS — proves the rejection below is the
      // audience check, not signature.
      const localJwks = createLocalJWKSet({ keys: [h.publicJwk] });
      const sanity = await jwtVerify(jwt, localJwks, {
        issuer: h.issuer,
        algorithms: ["RS256"],
      });
      expect(sanity.payload.aud).toBe("some-other-app");

      const { defaultAccessVerifier } = await import("../middleware/access-auth");
      const payload = await defaultAccessVerifier(jwt, {
        teamDomain: h.teamDomain,
        audience: AUDIENCE,
      });
      expect(payload).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("unsigned (alg=none) token from the original 'trust the header' regression is rejected", async () => {
    const h = await newHarness();
    try {
      // Craft an unsigned three-segment JWT exactly like the previous
      // middleware would have accepted at face value.
      const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
        .replace(/=+$/, "")
        .replace(/\//g, "_")
        .replace(/\+/g, "-");
      const payload = btoa(JSON.stringify({ email: "attacker@example.com" }))
        .replace(/=+$/, "")
        .replace(/\//g, "_")
        .replace(/\+/g, "-");
      const unsigned = `${header}.${payload}.`;
      const { defaultAccessVerifier } = await import("../middleware/access-auth");
      const out = await defaultAccessVerifier(unsigned, {
        teamDomain: h.teamDomain,
        audience: AUDIENCE,
      });
      expect(out).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});
