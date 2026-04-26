# @lyre/api-worker

Cloudflare Worker entry for the Lyre platform — a thin Hono app that
mounts the framework-agnostic handlers in `@lyre/api`.

Status: Wave C.1 of `docs/03-cf-worker-migration-plan.md` — scaffolded,
tests passing, but **not deployable yet** (D1 binding IDs are
placeholders, CF Access JWT signature verification is stubbed).

## Layout

```
src/
├── index.ts              # Hono app + scheduled() entrypoint
├── bindings.ts           # Worker bindings + Hono Variables types
├── middleware/
│   ├── runtime-context.ts # Build per-request RuntimeContext (env + db)
│   ├── bearer-auth.ts     # Authorization: Bearer <token>
│   └── access-auth.ts     # Cf-Access-Jwt-Assertion (signature TODO)
├── lib/
│   ├── env.ts            # Bindings → LyreEnv mapping
│   ├── d1.ts             # Drizzle/D1 driver wrapper
│   ├── cron-ctx.ts       # RuntimeContext for scheduled() cron tick
│   └── to-response.ts    # HandlerResponse → Hono Response converter
├── routes/               # One Hono sub-app per packages/api handler file
│   ├── live.ts, me.ts, folders.ts, tags.ts, recordings.ts, jobs.ts,
│   ├── dashboard.ts, search.ts, upload.ts
│   └── settings/{ai,backup,backy,oss,tokens}.ts
└── __tests__/            # Smoke + auth-gate integration tests
```

## Commands

Run from this directory:

```bash
bun test          # Bun-based unit tests (no wrangler runtime)
bun run typecheck # tsc --noEmit
bun run dev       # wrangler dev --port 7017 --local (needs wrangler installed)
bun run deploy    # wrangler deploy (needs real D1 binding ids)
```

## Known gaps

- **CF Access JWT signature** — `middleware/access-auth.ts` decodes the
  payload but does NOT verify the signature. Production hardening must
  add a JWKS fetch + RS256 verify against the team Access certs URL
  before exposing this Worker outside CF Access.
- **D1 binding IDs** — `wrangler.toml` carries
  `PLACEHOLDER_PROD_D1_ID` / `PLACEHOLDER_TEST_D1_ID`. Wave C.2 / C.3
  swap these in once the D1 instances exist.
- **`wrangler dev`** — not exercised in CI. Tests use Bun directly
  against the Hono `app.request()` API, so they don't need workerd.
- **No SSE** — by design (decision 3 / 8 in the migration plan).
- **`/api/me` payload** — returns `{ email, name, avatarUrl }`. Adjust
  if the SPA needs more fields.
