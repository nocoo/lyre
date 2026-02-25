# Lyre - Project Guide

Audio recording management and transcription platform with word-level karaoke playback.

## Monorepo Structure

Bun native workspaces monorepo. All web app code lives in `apps/web/`.

```
lyre/
├── apps/
│   ├── web/          ← Next.js app (@lyre/web)
│   │   ├── src/      ← Source code
│   │   ├── public/   ← Static assets
│   │   ├── scripts/  ← Build/test helper scripts
│   │   ├── database/ ← SQLite DB (gitignored)
│   │   └── ...       ← Config files (tsconfig, eslint, next.config, etc.)
│   └── macos/        ← Tauri macOS menu bar app (Rust)
│       ├── src-tauri/  ← Rust source, Cargo.toml, tauri.conf.json
│       ├── frontend/   ← Minimal HTML placeholder (tray-only app)
│       └── tests/      ← Integration/E2E tests
├── packages/         ← Shared packages placeholder (.gitkeep)
├── package.json      ← Root workspace config (proxies scripts to apps/web)
├── bun.lock
├── .husky/           ← Git hooks
├── Dockerfile        ← Multi-stage build (monorepo-aware)
├── CLAUDE.md
├── README.md
├── CHANGELOG.md
└── LICENSE
```

## Tech Stack

### Web (apps/web)

- **Runtime**: Bun
- **Framework**: Next.js 16 (App Router, standalone output)
- **Language**: TypeScript 5 (strict)
- **Database**: SQLite via Drizzle ORM (`apps/web/database/lyre.db`, override with `LYRE_DB`)
- **UI**: shadcn/ui + Radix UI + Tailwind CSS v4 (utility classes only, no CSS modules)
- **Icons**: `lucide-react` (the only icon library — do not introduce others)
- **Auth**: NextAuth v5 + Google OAuth with email allowlist
- **Storage**: Aliyun OSS (zero-SDK, custom V1 signature)
- **ASR**: Aliyun DashScope (`qwen3-asr-flash-filetrans`)
- **Path alias**: `@/*` → `./src/*` (relative to `apps/web/`)

### macOS App (apps/macos)

- **Framework**: Tauri v2 (menu bar / system tray app, no window)
- **Language**: Rust (edition 2021)
- **Audio**: `cpal` (CoreAudio backend) + `hound` (WAV encoding)
- **Features**: Microphone enumeration, recording with tray icon indicator, WAV file output
- **Testing**: `cargo test` (UT + integration), `cargo clippy` (lint)

## Key Commands

All commands run from the **repository root**. Root `package.json` proxies them via `bun run --cwd apps/web`.

```bash
bun dev                # Start web dev server (port 7025)
bun run build          # Web production build
bun run test           # Run web unit tests
bun run test:coverage  # Run web tests with coverage check
bun run test:e2e       # Run web E2E tests (port 17025, independent DB)
bun run lint           # Run ESLint (web)
bun run db:push        # Apply schema to database
bun run db:studio      # Open Drizzle Studio
```

### macOS App Commands

Run from `apps/macos/src-tauri/`:

```bash
cargo build            # Build macOS app (debug)
cargo test             # Run UT + integration tests
cargo clippy -- -D warnings  # Lint (zero warnings)
cargo tauri dev        # Run app in dev mode
cargo tauri build      # Build release .app bundle
```

## Git Hooks (Husky)

- **pre-commit**: `bun run test && bun run lint`
- **pre-push**: `bun run test:coverage && bun run lint && bun run test:e2e`

All code must pass UT + lint before commit. Coverage + E2E are enforced before push.

## E2E Test Infrastructure

- **Port**: E2E server runs on port **17025** (dev/prod uses 7025)
- **Auth bypass**: `PLAYWRIGHT=1` env var skips login/auth in E2E. Set automatically by the runner script.
- **Database**: Each E2E run uses an independent SQLite DB (auto-created, isolated from dev data)
- **ASR mock**: The runner unsets `DASHSCOPE_API_KEY` to force mock ASR mode
- **Runner**: `apps/web/scripts/run-e2e.ts` — spawns a Next.js dev server, waits for health, runs tests, then tears down

### Real LLM Integration Tests

Some E2E tests make **real API calls** to an LLM provider. These require credentials stored in `.env.e2e` (gitignored, never committed).

- **Template**: `apps/web/.env.e2e.example` is checked in — copy it to `apps/web/.env.e2e` and fill in real values
- **Required vars**: `AI_E2E_AUTH_TOKEN`, `AI_E2E_BASE_URL`, `AI_E2E_MODEL`
- **Graceful skip**: Tests use `test.skipIf(!HAS_AI_CREDS)` — they skip cleanly when `.env.e2e` is absent or incomplete
- **CI/local**: Works in both — CI can inject secrets via env vars; locally just populate `.env.e2e`

## Architecture Notes

- **Scrollable container**: The app's main scrollable element lives in `src/components/layout/app-shell.tsx` — a `<div>` with `overflow-y-auto` inside the floating island content area. Scroll-to-top FAB is attached here.
- **Sonner toast**: `<Toaster />` is mounted in `src/app/layout.tsx` (uses `theme="system"`, no `next-themes` dependency). Import `toast` from `sonner` to show notifications.
- **ASR mock**: Set `DASHSCOPE_API_KEY` to empty or omit it entirely to use the mock ASR provider. E2E tests unset this key to force mock mode.
- **Suspense boundaries**: Components using `useSearchParams()` must be wrapped in `<Suspense>`. Currently applied in `app-shell.tsx` (for Sidebar) and `recordings/page.tsx` (for the page content).

## Version Management

Version is managed from the **root `package.json`** as the single source of truth, kept in sync across all sub-projects:

| Location | File | Field |
|---|---|---|
| Root (source of truth) | `package.json` | `version` |
| Web app | `apps/web/package.json` | `version` |
| Web API fallback | `apps/web/src/app/api/live/route.ts` | hardcoded string |
| macOS Rust crate | `apps/macos/src-tauri/Cargo.toml` | `version` |
| macOS Tauri config | `apps/macos/src-tauri/tauri.conf.json` | `version` |
| macOS frontend | `apps/macos/frontend/package.json` | `version` |

- `src/lib/version.ts` imports `package.json` at build time and exports `APP_VERSION`
- Sidebar displays the version badge (in `src/components/layout/sidebar.tsx`)
- `/api/live` endpoint returns the version in its JSON response
- macOS About page reads the version from `tauri.conf.json` via `getVersion()`

### How to bump version

1. Update `version` in **all 6 locations** listed above (root, web, web fallback, Cargo.toml, tauri.conf.json, macos frontend)
2. Create a git tag: `git tag v<version>`
3. Push tag: `git push origin v<version>`
4. Build macOS app: `cargo tauri build` (from `apps/macos/src-tauri/`)
5. Create GitHub release with macOS `.dmg`: `gh release create v<version> --generate-notes path/to/Lyre.dmg`

## Project Structure (apps/web/src/)

```
src/
├── app/              # Next.js App Router pages & API routes
│   ├── api/          # REST endpoints (recordings, jobs, transcriptions, live, etc.)
│   ├── login/        # OAuth login page
│   ├── recordings/   # Recording list & detail pages
│   └── settings/     # App settings page
├── components/       # React components
│   ├── layout/       # App shell, sidebar, breadcrumbs
│   ├── ui/           # shadcn/ui primitives
│   ├── audio-player.tsx
│   ├── transcript-viewer.tsx
│   └── upload-dialog.tsx
├── db/               # Drizzle schema & repository layer
├── services/         # OSS & ASR service layer
├── hooks/            # React hooks
├── lib/              # Types, utils, view models, version
└── __tests__/        # Unit tests & E2E tests
```

## Project Structure (apps/macos/src-tauri/)

```
src-tauri/
├── src/
│   ├── main.rs       # Tauri app entry point (setup tray, plugins)
│   ├── lib.rs        # Library root (re-exports for integration tests)
│   ├── audio.rs      # Audio device enumeration (cpal)
│   ├── recorder.rs   # WAV recording engine (cpal + hound)
│   └── tray.rs       # System tray menu & event handling
├── icons/            # App & tray icons (generated from logo.png)
├── capabilities/     # Tauri v2 security capabilities
├── tests/
│   └── e2e.rs        # Integration tests (real recording pipeline)
├── Cargo.toml
├── build.rs
└── tauri.conf.json
```

### macOS App Architecture

- **Tray-only app**: No window UI. All interaction via system tray menu.
- **Menu structure**: Start/Stop Recording → Input Device submenu → Output folder → Quit
- **Recording indicator**: Tray icon switches between template (idle) and red-dot (recording)
- **Audio capture**: ScreenCaptureKit (macOS 15.0+) captures both system audio and microphone in a single `SCStream`. Requires "Screen & System Audio Recording" permission.
- **Thread safety**: `SCStream` is !Send on macOS. The recorder must stay on the thread that created it (main thread).
- **E2E tests**: Skip gracefully when ScreenCaptureKit permission is not granted (CI-safe). Recording tests are serialized via a global mutex due to a `screencapturekit` crate handler dispatch bug.

## Retrospective

- **useSearchParams() needs Suspense**: In Next.js 16, any component using `useSearchParams()` must be wrapped in a `<Suspense>` boundary, otherwise the production build fails during static page generation. This applies to both page components and shared components like Sidebar.
- **SQLite WAL mode: always checkpoint before copying**: When copying a SQLite database file, `ALTER TABLE` and other schema changes may live in the `.db-wal` file, not the main `.db` file. Always run `PRAGMA wal_checkpoint(TRUNCATE)` before `cp`, or copy all three files (`.db`, `.db-shm`, `.db-wal`) together. Copying only the `.db` file silently loses uncommitted WAL changes.
- **Production DB schema must be migrated after schema changes**: Drizzle schema changes (new columns, new tables) only affect the local dev DB when running `db:push`. The production SQLite on Railway volume is **not** auto-migrated on deploy. After any schema change, SSH into the Railway container (`railway ssh`) and run the necessary `ALTER TABLE ADD COLUMN` statements via `bun -e` (since `sqlite3` CLI is not available in the standalone image). Always run `PRAGMA wal_checkpoint(TRUNCATE)` after migration. Failure to migrate causes silent HTTP 500 errors because Drizzle generates SQL referencing columns that don't exist yet — and without try/catch the real error (`table X has no column named Y`) is swallowed by Next.js's generic 500 handler.
- **Pre-push hook must include `bun run build`**: UT, lint, and E2E alone do NOT catch TypeScript type errors that only surface during `next build` (which runs full `tsc`). ESLint doesn't flag array-index `string | undefined` narrowing issues, and E2E uses `next dev` which skips type checking. The pre-push hook order is: `test:coverage → lint → build → test:e2e`.
- **screencapturekit crate dispatches to ALL handlers**: The `screencapturekit` crate v1.5 uses a global `HANDLER_REGISTRY` and its `sample_handler` callback iterates over ALL registered handlers for every sample buffer, ignoring the `SCStreamOutputType` they were registered with. This means registering separate handlers for `Audio` and `Microphone` causes each buffer to be delivered twice (once per handler), doubling the encoded data. Workaround: register a single handler on `SCStreamOutputType::Audio` and let `did_output_sample_buffer` handle both Audio and Microphone types via the `output_type` parameter.
- **LAME encoder crashes on non-finite PCM samples**: The `mp3lame-encoder` crate's internal `calc_energy` function in `psymodel.c` asserts `el >= 0`, which fails (SIGABRT) when input contains NaN or Infinity values. ScreenCaptureKit can occasionally deliver such values in audio buffers. Always sanitize f32 PCM samples before encoding: replace non-finite values with 0.0 and clamp to [-1.0, 1.0].
