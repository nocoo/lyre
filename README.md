<p align="center">
  <img src="apps/web/public/logo-80.png" alt="Lyre Logo" width="80" height="80">
</p>

<h1 align="center">Lyre</h1>

<p align="center">
  <strong>Audio recording management and transcription platform</strong><br>
  Upload · Transcribe · Explore
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vite-7-646CFF" alt="Vite">
  <img src="https://img.shields.io/badge/Cloudflare%20Workers-Hono-F38020" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/D1-SQLite-003A70" alt="Cloudflare D1">
  <img src="https://img.shields.io/badge/TypeScript-5-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

<p align="center">
  <img src="https://s.zhe.to/dcd0e6e42358/20260222/968a964f-c888-4e27-955e-8f52e3df0f80.jpg" alt="Lyre Preview" width="720">
</p>

---

## Features

- **Audio Upload** — Direct-to-OSS presigned upload with progress tracking (up to 500 MB)
- **ASR Transcription** — Aliyun DashScope async job, polled by a Cloudflare Cron Trigger
- **AI Summaries** — Multi-provider LLM summarization (OpenAI, Anthropic) with streaming markdown
- **Audio Player** — Custom player with play/pause, skip, variable speed, and progress seeking
- **Transcript Viewer** — Sentence view synced to playback, full-text view, one-click copy
- **Word-Level Karaoke** — Lazy-loaded word timestamps, clickable words for seeking, real-time highlighting
- **Recording Management** — CRUD, search, folders, tags, status filter, pagination, and sorting
- **Dashboard** — Charts and statistics for recording activity overview
- **Cloudflare Access SSO** — Email-based access control enforced at the edge
- **Cloudflare D1** — Serverless SQLite store managed entirely on the Cloudflare edge
- **Remote Backup** — Bidirectional Backy integration (push + pull webhook)
- **macOS App** — Native Swift/SwiftUI menu bar app for meeting recording (mic + system audio)

## Architecture

```
                ┌──────────────────────────────────────────┐
   Browser ───▶ │ Cloudflare Access (SSO + JWT)            │
                ├──────────────────────────────────────────┤
                │ Worker `lyre-api`  (apps/api)            │
                │   • Hono router                          │
                │   • Static SPA via [assets] (apps/web)   │
                │   • D1 binding `DB`                      │
                │   • Cron Trigger → ASR poll              │
                └──────────────────────────────────────────┘
                         │              │
                         ▼              ▼
                   Aliyun OSS    Aliyun DashScope
                   (audio blobs)  (qwen3-asr-flash)
```

- `apps/web` — Vite SPA, served as static assets by the Worker.
- `apps/api` — Hono Worker entry, middleware (Access JWT, bearer token), and route adapters.
- `packages/api` — Framework-agnostic handlers, services, repos, contracts (`@lyre/api`).
- `apps/macos` — Native menu bar recorder that uploads via the Worker API.

## Quick Start

### 1. Install dependencies

```bash
# Requires Bun: https://bun.sh
bun install
```

### 2. Configure environment variables

The Worker reads its config from Wrangler (`apps/api/wrangler.toml` + secrets).
The Vite SPA only needs the API origin at build time.

> See **[docs/01-deployment.md](docs/01-deployment.md)** for the full list of
> Cloudflare bindings (D1, vars, secrets) and how to provision them.

### 3. Local development

```bash
# Vite SPA (web UI)
bun run web:dev

# Hono Worker against a local D1 (separate terminal)
bun run worker:dev
```

### 4. Deploy

```bash
# Build the SPA into apps/web/dist, then publish the Worker
bun run deploy        # production
bun run deploy:test   # staging environment
```

## Project Structure

```
lyre/
├── apps/
│   ├── web/        Vite SPA (@lyre/web) — bundled into the Worker as static assets
│   ├── api/        Hono Worker (@lyre/api-worker) — entry, middleware, routes, cron
│   └── macos/      Native Swift/SwiftUI menu bar app
├── packages/
│   └── api/        @lyre/api — handlers, services, repos, contracts (framework-agnostic)
├── docs/
└── package.json    Bun workspaces root
```

## Tech Stack

| Layer       | Technology                                              |
|-------------|---------------------------------------------------------|
| Runtime     | Bun (dev/build), Cloudflare Workers (prod)              |
| Web         | Vite 7 + React 19 + TypeScript 5                        |
| API         | Hono 4 on Cloudflare Workers                            |
| Database    | Cloudflare D1 (SQLite) via Drizzle ORM                  |
| UI          | shadcn/ui + Radix UI + Tailwind CSS v4                  |
| Auth        | Cloudflare Access (web) + bearer device tokens (macOS)  |
| AI          | Vercel AI SDK (OpenAI + Anthropic)                      |
| Storage     | Aliyun OSS (zero-SDK, custom V1 signature)              |
| ASR         | Aliyun DashScope (`qwen3-asr-flash-filetrans`)          |
| Job polling | Cloudflare Cron Trigger → `cronTickHandler`             |
| Deploy      | Wrangler (`bun run deploy`)                             |

## Common Commands

| Command                  | Description                                              |
|--------------------------|----------------------------------------------------------|
| `bun run web:dev`        | Start the Vite SPA dev server                            |
| `bun run worker:dev`     | Start the Hono Worker locally (Wrangler)                 |
| `bun run lint`           | Lint web + `@lyre/api`                                   |
| `bun run typecheck`      | Typecheck web + worker + `@lyre/api`                     |
| `bun run test`           | Unit tests for web + worker + `@lyre/api`                |
| `bun run test:coverage`  | `@lyre/api` coverage gate                                |
| `bun run deploy`         | Build SPA + publish Worker to production                 |
| `bun run deploy:test`    | Build SPA + publish Worker to staging                    |

## License

[MIT](LICENSE) © 2026
