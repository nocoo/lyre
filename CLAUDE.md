# Lyre - Project Guide

Audio recording management and transcription platform with word-level karaoke playback.
Runs as a single Cloudflare Worker that serves the Vite SPA from its asset
binding and exposes the Hono-based API on the same origin.

## Monorepo Layout

Bun-native workspaces. There is no Next.js / Railway / SQLite-on-disk story —
production is Cloudflare Workers + D1 + R2-style Aliyun OSS, and the dev loop
uses Wrangler + a Vite dev server.

```
lyre/
├── apps/
│   ├── web/        Vite SPA (@lyre/web) — bundled into the Worker as static assets
│   ├── api/        Hono Worker (@lyre/api-worker) — entry, middleware, routes, cron
│   └── macos/      Native Swift/SwiftUI menu bar app
├── packages/
│   └── api/        @lyre/api — handlers, services, repos, contracts (framework-agnostic)
├── docs/
├── .husky/         Git hooks (pre-commit, pre-push)
├── package.json    Bun workspaces root
├── README.md
├── CLAUDE.md
├── CHANGELOG.md
└── LICENSE
```

## Tech Stack

### Web (apps/web)

- **Build**: Vite 7 (SSG-free SPA, output to `dist/`)
- **UI**: React 19 + TypeScript 5 (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Icons**: `lucide-react` (the only icon library — do not introduce others)
- **Routing**: React Router (with a small `router-compat` shim)
- **State**: TanStack Query for server state
- **Markdown**: `react-markdown` + `remark-gfm` (AI summary rendering)
- **Theming**: dark/light mode via in-house `theme-utils` + `<ThemeToggle>`
- **Path alias**: `@/*` → `apps/web/src/*`

### API Worker (apps/api)

- **Runtime**: Cloudflare Workers
- **Framework**: Hono 4
- **Bindings**: `DB` (D1), `ASSETS` (Vite SPA), env vars and secrets via Wrangler
- **Auth**: Cloudflare Access JWT for browser sessions; bearer device tokens for the macOS app
- **Cron**: Cloudflare Cron Trigger drives `cronTickHandler` for ASR job polling

### Shared API package (packages/api)

- **Purpose**: Framework-agnostic handlers, services, repos, and contracts.
  Imported by `apps/api` (production), and exercised directly in unit tests.
- **DB**: Drizzle ORM. `LyreDb` is opaque — D1 in production, in-memory `bun:sqlite` in tests.
- **Storage**: Aliyun OSS (zero SDK, custom V1 signature)
- **ASR**: Aliyun DashScope (`qwen3-asr-flash-filetrans`)
- **AI**: Vercel AI SDK (multi-provider: OpenAI, Anthropic, OpenAI-compatible)
- **DI**: Every handler receives a `RuntimeContext { env, db, user, headers }` — no global singletons

### macOS App (apps/macos)

- **Framework**: SwiftUI (`MenuBarExtra`) + AppKit glue
- **Language**: Swift 6 (strict concurrency)
- **Minimum macOS**: 15.0 (full ScreenCaptureKit support)
- **Audio**: ScreenCaptureKit (system + mic) → AudioMixer → AudioEncoder (AVAssetWriter M4A/AAC)
- **Build**: xcodegen → Xcode project → `xcodebuild`
- **Networking**: URLSession (async/await)
- **Testing**: Swift Testing (`xcodebuild test`), SwiftLint (lint)
- **Code Signing**: Apple Development + Automatic signing (Team ID `93WWLTN9XU`)

## Key Commands (run from repo root)

```bash
# Dev
bun run web:dev               # Vite SPA dev server
bun run worker:dev            # Hono Worker via Wrangler (local D1)

# Quality gates
bun run lint                  # web + @lyre/api
bun run typecheck             # web + worker + @lyre/api
bun run test                  # unit tests (web + worker + @lyre/api)
bun run test:coverage         # @lyre/api coverage gate

# Deploy
bun run deploy                # build SPA + publish Worker
```

### macOS app commands (run from `apps/macos/`)

```bash
xcodegen generate
xcodebuild build -project Lyre.xcodeproj -scheme Lyre -configuration Debug -destination "platform=macOS"
xcodebuild test  -project Lyre.xcodeproj -scheme LyreTests -configuration Debug -destination "platform=macOS"
swiftlint lint Lyre/
```

## Git Hooks (Husky)

- **pre-commit**: gitleaks (secret scan) → `bun run lint` → `bun run test` → `bun run typecheck`, then macOS UT + lint.
- **pre-push**: osv-scanner (deps) → `bun run lint` → `bun run typecheck` → `bun run test:coverage` → `bun run web:build`, then macOS UT + lint.

## Architecture Notes

- **Single deployment unit**: `bun run deploy` builds the SPA into `apps/web/dist`, and Wrangler publishes the Worker with that directory bound as `ASSETS`. The browser hits one origin; static assets and `/api/*` are both served by the same Worker.
- **Auth**: Cloudflare Access fronts the Worker. The `Cf-Access-Jwt-Assertion` header is decoded in `apps/api/src/middleware/access-auth.ts` (signature verification is a TODO — fine while behind Access, MUST be added before exposing the Worker directly). The macOS app uses bearer device tokens via `apps/api/src/middleware/bearer-auth.ts`. E2E sets `E2E_SKIP_AUTH=true` to synthesize a stable test user.
- **DB**: `RuntimeContext.db` carries the live D1 handle in production; tests use a per-suite in-memory `bun:sqlite` Drizzle handle (`packages/api/src/__tests__/_fixtures/test-db.ts`). Repositories are constructed per request via `makeRepos(db)` — never globally.
- **Env**: `apps/api/src/lib/env.ts` maps `c.env` (Cloudflare Bindings) into the typed `LyreEnv`. `@lyre/api` reads env only via `ctx.env`.
- **ASR mock**: When `DASHSCOPE_API_KEY` is unset/empty, `getAsrProvider(env)` returns the mock provider with realistic timing — used by unit tests and by local dev when no real key is supplied.
- **Job polling**: ASR jobs are polled out-of-band by the Cloudflare Cron Trigger which calls `cronTickHandler` via `apps/api/src/lib/cron-ctx.ts`. The SPA hook `useJobEvents` polls `/api/jobs` for status updates (no SSE).

## Version Management

Version is managed from the **root `package.json`** as the single source of truth, kept in sync across all workspaces.

| Location               | File                            | Field                |
|------------------------|---------------------------------|----------------------|
| Root (source of truth) | `package.json`                  | `version`            |
| Web app                | `apps/web/package.json`         | `version`            |
| Worker                 | `apps/api/package.json`         | `version`            |
| Shared API             | `packages/api/package.json`     | `version`            |
| macOS app              | `apps/macos/project.yml`        | `MARKETING_VERSION`  |

- `packages/api/src/lib/version.ts` imports `package.json` at build time and exports `APP_VERSION` (Vite inlines it).
- `/api/live` returns the version in its JSON response.
- macOS About page reads `CFBundleShortVersionString` (set by `MARKETING_VERSION`).
- `bun run release` walks all workspace `package.json` files (`scripts/release.ts`).

### How to bump version

1. Update `version` in all four `package.json` files and `MARKETING_VERSION` in `apps/macos/project.yml`.
2. Run `xcodegen generate` from `apps/macos/` to sync `project.pbxproj`.
3. Update `CHANGELOG.md` with changes since last version.
4. Commit, push, then tag and release via `gh`.

## Project Layout Detail

### apps/web/src

```
App.tsx                    React Router root
main.tsx                   Vite entry
pages/                     Route components (dashboard, recordings, settings/*)
components/                Feature components + layout/ + ui/ (shadcn)
hooks/                     use-job-events, use-me, use-mobile
lib/                       api client, view models, theme utils, version
__tests__/                 Vitest/bun unit tests
```

### apps/api/src

```
index.ts                   Worker entry — Hono app + scheduled() handler
bindings.ts                Cloudflare Bindings + Hono Variables types
middleware/
  runtime-context.ts       Builds RuntimeContext per request
  access-auth.ts           Cloudflare Access JWT decode → user
  bearer-auth.ts           Device token → user
routes/
  live, me, dashboard, recordings, jobs, folders, tags, search, upload, backy
  settings/                ai, backy, backup, oss, tokens
lib/
  d1.ts                    `openD1(binding)` Drizzle wrapper
  env.ts                   Bindings → LyreEnv mapping
  cron-ctx.ts              RuntimeContext for scheduled() runs
  to-response.ts           HandlerResponse → native Response
__tests__/                 Worker integration tests (Hono test client)
```

### packages/api/src

```
contracts/                 Pure types shared with the SPA (jobs, recordings, ai)
db/
  schema.ts                Drizzle schema (users, recordings, folders, tags, …)
  types.ts                 LyreDb type alias
  drivers/result.ts        rowsAffected helper (D1/bun-sqlite agnostic)
  repositories/            Per-table factories: makeUsersRepo(db), …, makeRepos(db)
runtime/
  env.ts                   LyreEnv type + emptyEnv() for tests
  context.ts               RuntimeContext type
handlers/                  Framework-agnostic: receive RuntimeContext + parsed input
services/
  ai.ts                    Vercel AI SDK wrapper, prompt builders
  asr.ts                   DashScope client + result parsing
  asr-provider.ts          Mock vs real provider selection
  oss.ts                   Aliyun OSS V1 sign + presign + delete
  backup.ts                Backup export/import
  backy.ts                 Backy push/pull integration
  job-processor.ts         pollJob() — single-job lifecycle on terminal states
lib/
  api-auth.ts              hashToken() — shared by bearer-auth + tokens handler
  palette.ts, sidebar-nav.ts, types.ts, version.ts
__tests__/                 vitest suites with in-memory SQLite
  _fixtures/test-db.ts     Bootstraps the in-memory DB
  _fixtures/runtime-context.ts  setupAuthedCtx(), testRepos(), …
```

### apps/macos

```
apps/macos/
├── project.yml                     xcodegen project definition
├── .swiftlint.yml
├── Lyre.xcodeproj/                 generated
├── Lyre/
│   ├── LyreApp.swift               @main, MenuBarExtra, TrayMenu, MainWindowView
│   ├── Audio/                      PermissionManager, AudioCaptureManager,
│   │                               AudioMixer, AudioEncoder, RecordingManager
│   ├── Recording/RecordingsStore.swift
│   ├── Network/{APIClient, UploadManager}.swift
│   ├── Config/AppConfig.swift
│   ├── Views/                      Recordings, Upload, Settings, About, PermissionGuide
│   └── Utilities/                  AudioPlayerManager, KeychainHelper
└── LyreTests/                      Smoke, Permission, AudioMixer, Encoder, Capture,
                                    RecordingManager, RecordingsStore, AppConfig,
                                    Keychain, APIClient, UploadManager, RecordingE2E
```

### macOS App Architecture

- **Tray-only app**: Menu bar icon with popup menu. Window UI via "Open Lyre..." menu item.
- **Menu structure**: Start/Stop Recording → Input Device submenu → Open Lyre... → Quit
- **Recording indicator**: Tray icon switches between template (idle) and red-dot (recording)
- **Audio capture**: ScreenCaptureKit (macOS 15.0+) captures both system audio and microphone in a single `SCStream`. Requires "Screen & System Audio Recording" permission.
- **Audio mixing**: Weighted mix (system 0.8× + mic 2.5×) with tanhf() soft clipping. Stereo→mono picks louder channel.
- **Input device memory**: Selected microphone persisted in AppConfig, restored on launch with fallback.
- **Upload flow**: Presign → OSS PUT → Create recording (3-step, with cancel support).
- **E2E tests**: Skip gracefully when ScreenCaptureKit permission is not granted (CI-safe).

## Retrospective

- **SCStream requires registering each output type separately**: Apple's `SCStream.addStreamOutput(_:type:)` must be called for **each** `SCStreamOutputType` you want to receive. Setting `capturesMicrophone = true` in `SCStreamConfiguration` enables microphone capture at the system level, but the stream only delivers microphone buffers if you also register an output handler with type `.microphone`. Without this registration, mic samples are silently discarded — the handler registered for `.audio` never sees them.
- **System audio + microphone are separate PCM streams that must be mixed**: ScreenCaptureKit delivers system audio and microphone as independent `CMSampleBuffer` streams. Simply concatenating both into the same encoder doubles the recording duration. The correct approach is an `AudioMixer` that buffers both sources independently and outputs their sample-by-sample average `(a + b) / 2`. The mixer also handles the single-source fallback (e.g. no mic permission) by draining the active buffer after a threshold (~100ms at 48kHz) to prevent unbounded accumulation.
- **D1 schema must be migrated explicitly after a schema change**: `wrangler d1 migrations apply` does not run automatically on `wrangler deploy`. After any Drizzle schema change, generate the SQL and apply it to the D1 database before deploying the Worker that depends on the new columns.
- **No global DB singleton**: Every repo is constructed via `makeRepos(db)` inside a handler with the request-scoped D1 handle. Adding a new singleton anywhere breaks D1 (no shared connection across requests) and breaks tests (no isolation between cases).
