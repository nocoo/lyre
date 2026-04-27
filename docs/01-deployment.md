# Deployment Guide

Lyre runs as a single Cloudflare Worker. The Vite SPA is bundled as static
assets served by the same Worker; the Hono API lives at `/api/*`. Storage is
Cloudflare D1 (SQLite at the edge). Audio blobs live in Aliyun OSS.

```
Cloudflare Access  →  Worker `lyre-api`
                       ├─ ASSETS  (apps/web/dist — Vite SPA)
                       ├─ DB      (D1 SQLite binding)
                       └─ Cron    (* * * * *)  →  cronTickHandler (ASR poll)
```

## Prerequisites

- [Bun](https://bun.sh) 1.0+ (build + tests)
- A Cloudflare account with **Workers Paid** (D1 + Cron Triggers + Access)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed as a workspace dep)
- Cloudflare Access configured for the Worker's hostname (or `E2E_SKIP_AUTH=true` for staging)
- An Aliyun account (OSS for audio blobs, DashScope for ASR)

## 1. Cloudflare Access (auth)

The Worker decodes the `Cf-Access-Jwt-Assertion` header set by Cloudflare
Access. Configure an Access application in the Cloudflare dashboard:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**
2. Hostname: the Worker's custom domain (e.g. `lyre.example.com`)
3. Add an Access policy with the email allowlist you want to grant access to.
4. Save.

> **Note**: JWT signature verification is currently a TODO inside
> `apps/api/src/middleware/access-auth.ts`. The Worker trusts the header
> on the assumption that traffic only reaches it via Cloudflare Access (which
> strips and re-injects the header at the edge). Do NOT expose the Worker on a
> hostname that is not behind Access until JWKS verification is wired up.

The macOS app authenticates separately with bearer device tokens; create
tokens via **Settings → Tokens** in the SPA.

## 2. Create the D1 database

```bash
# From the repo root (one-time per environment)
bunx wrangler d1 create lyre-db          # production
bunx wrangler d1 create lyre-db-test     # staging
```

Copy the returned `database_id` values into `apps/api/wrangler.toml` under the
`[[d1_databases]]` and `[[env.test.d1_databases]]` blocks.

### Apply the schema

```bash
# Production
bunx wrangler d1 execute lyre-db --remote --file packages/api/src/db/schema.sql

# Staging
bunx wrangler d1 execute lyre-db-test --remote --file packages/api/src/db/schema.sql
```

(If you change Drizzle schema, regenerate the SQL and re-apply via
`wrangler d1 execute --remote --file <new.sql>`. There is no auto-migration
on `wrangler deploy`.)

## 3. Aliyun OSS

Lyre stores audio blobs in Aliyun OSS. The integration uses zero SDK — all
requests are signed with a custom V1 signature implementation in
`packages/api/src/services/oss.ts`.

### Create a bucket

1. Log in to the [Aliyun Console](https://home.console.aliyun.com/).
2. **Object Storage Service (OSS) → Create Bucket**.
   - Bucket name: `lyre` (production) or `lyre-dev` (staging/dev)
   - Region: pick one close to your users (e.g. `oss-cn-beijing`)
   - Storage class: **Standard**
   - Access control: **Private**
3. Note the **Region ID** and **Endpoint**.

### Create a RAM user with OSS access

1. **RAM (Resource Access Management) → Users → Create User**.
2. Check **OpenAPI Access** to generate an AccessKey pair.
3. Save the **AccessKey ID** and **AccessKey Secret** (the secret is shown once).
4. Attach the **AliyunOSSFullAccess** policy (or a custom least-privilege policy):

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "oss:*",
      "Resource": [
        "acs:oss:*:*:lyre",      "acs:oss:*:*:lyre/*",
        "acs:oss:*:*:lyre-dev",  "acs:oss:*:*:lyre-dev/*"
      ]
    }
  ]
}
```

### Configure CORS for browser uploads

In the OSS Console, **bucket → Access Control → Cross-Origin Resource Sharing**:

| Field            | Value                                                       |
|------------------|-------------------------------------------------------------|
| Allowed Origins  | The Worker's custom domain (e.g. `https://lyre.example.com`) |
| Allowed Methods  | `GET, PUT, HEAD`                                            |
| Allowed Headers  | `*`                                                         |
| Expose Headers   | `ETag`                                                      |

## 4. Aliyun DashScope ASR

Lyre uses [DashScope](https://dashscope.aliyuncs.com/) for transcription
(`qwen3-asr-flash-filetrans`).

1. Open the [DashScope console](https://dashscope.console.aliyun.com/) and
   activate DashScope (free to activate, pay-per-use).
2. **API-KEY Management → Create API Key**.
3. Save the generated key.

If `DASHSCOPE_API_KEY` is unset/empty, the API falls back to a mock provider
that returns deterministic placeholder transcriptions — useful for staging
and tests without incurring API costs.

## 5. Push secrets to the Worker

`apps/api/wrangler.toml` keeps non-secret config in `[vars]`. Push the rest
via `wrangler secret put`:

```bash
cd apps/api

# Production
bunx wrangler secret put OSS_ACCESS_KEY_ID
bunx wrangler secret put OSS_ACCESS_KEY_SECRET
bunx wrangler secret put OSS_REGION
bunx wrangler secret put OSS_ENDPOINT
bunx wrangler secret put DASHSCOPE_API_KEY      # optional

# Staging — same keys, but with --env test
bunx wrangler secret put OSS_ACCESS_KEY_ID --env test
# ...etc.
```

## 6. Build & deploy

```bash
# Production
bun run deploy

# Staging
bun run deploy:test
```

`bun run deploy` runs `web:build` (Vite → `apps/web/dist`) and then
`wrangler deploy` from `apps/api` (which uploads the bundled SPA via the
`[assets]` directory and the Worker code itself).

## 7. Local development

```bash
# Vite SPA on http://localhost:5173 by default
bun run web:dev

# Hono Worker on http://localhost:7017 with a local D1 + assets
bun run worker:dev
```

The local Worker uses Wrangler's `--local` mode, which provisions an ephemeral
SQLite-backed D1 instance. Apply the schema once with `wrangler d1 execute`
(without `--remote`) before exercising routes that hit the DB.

## Environment variable reference

These are the bindings expected on the Worker side
(`apps/api/src/bindings.ts`). Non-secret values live in `wrangler.toml`;
secrets must be pushed via `wrangler secret put`.

| Variable                | Source            | Required | Description                                                  |
|-------------------------|-------------------|----------|--------------------------------------------------------------|
| `DB`                    | D1 binding        | Yes      | The D1 database binding                                       |
| `ASSETS`                | Asset binding     | Yes      | The Vite SPA static asset binding                             |
| `NODE_ENV`              | `[vars]`          | Yes      | `production` selects the prod OSS bucket and disables E2E    |
| `OSS_BUCKET`            | `[vars]`          | No       | Override bucket name; defaults to `lyre` (prod) or `lyre-dev` |
| `OSS_ACCESS_KEY_ID`     | secret            | Yes      | Aliyun RAM AccessKey ID                                       |
| `OSS_ACCESS_KEY_SECRET` | secret            | Yes      | Aliyun RAM AccessKey Secret                                   |
| `OSS_REGION`            | secret or `[vars]` | Yes     | OSS region, e.g. `oss-cn-beijing`                             |
| `OSS_ENDPOINT`          | secret or `[vars]` | Yes     | OSS endpoint URL                                              |
| `DASHSCOPE_API_KEY`     | secret            | No       | DashScope API key; omit/empty for mock ASR                    |
| `SKIP_OSS_ARCHIVE`      | `[vars]`          | No       | `"1"` skips raw ASR JSON archival (used by tests)             |
| `E2E_SKIP_AUTH`         | `[vars]`          | No       | `"true"` enables a synthetic test user (staging only)         |
