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
│   └── macos/        ← Native Swift/SwiftUI menu bar app
│       ├── Lyre/       ← Swift source code
│       ├── LyreTests/  ← Unit + E2E tests (Swift Testing)
│       └── project.yml ← xcodegen project definition
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

- **Framework**: SwiftUI (`MenuBarExtra`) + AppKit glue
- **Language**: Swift 6 (strict concurrency)
- **Minimum macOS**: 15.0 (full ScreenCaptureKit support)
- **Audio**: ScreenCaptureKit (system + mic) → AudioMixer → AVAssetWriter (M4A/AAC)
- **Build System**: xcodegen (`project.yml`) → Xcode project → `xcodebuild`
- **Networking**: URLSession (async/await)
- **Features**: Meeting recording (mic + system audio), upload to Lyre server, input device memory
- **Testing**: Swift Testing framework (`xcodebuild test`), SwiftLint (lint)
- **Code Signing**: Apple Development certificate (Team ID `93WWLTN9XU`)

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

Run from `apps/macos/`:

```bash
xcodegen generate                  # Regenerate Xcode project from project.yml
xcodebuild build -project Lyre.xcodeproj -scheme Lyre -configuration Debug -destination "platform=macOS"
xcodebuild test -project Lyre.xcodeproj -scheme LyreTests -configuration Debug -destination "platform=macOS"
swiftlint lint Lyre/               # Lint production code (zero violations)
```

## Git Hooks (Husky)

- **pre-commit**: Web UT + lint, then macOS UT + lint
- **pre-push**: Web coverage + lint + build + E2E, then macOS UT + lint + E2E

All code (web + macOS) must pass UT + lint before commit. Coverage, build, and E2E are enforced before push.

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
| macOS app | `apps/macos/project.yml` | `MARKETING_VERSION` |

- Version format: `1.2.3` in source, displayed as `v1.2.3` in UI and releases
- `src/lib/version.ts` imports `package.json` at build time and exports `APP_VERSION`
- Sidebar displays the version badge (in `src/components/layout/sidebar.tsx`)
- `/api/live` endpoint returns the version in its JSON response (via `APP_VERSION`)
- macOS About page reads the version from `CFBundleShortVersionString` (set by `MARKETING_VERSION`)

### How to bump version

1. Update `version` in **all 3 locations** listed above (root, web, project.yml MARKETING_VERSION)
2. Run `xcodegen generate` from `apps/macos/` to sync `project.pbxproj`
3. Update `CHANGELOG.md` with changes since last version
4. Commit, push, then tag and release via `gh`

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

## Project Structure (apps/macos/)

```
apps/macos/
├── project.yml                    ← xcodegen project definition
├── .swiftlint.yml                 ← SwiftLint config
├── Lyre.xcodeproj/                ← Generated (xcodegen generate)
├── Lyre/
│   ├── LyreApp.swift              ← @main, MenuBarExtra, TrayMenu, MainWindowView
│   ├── Constants.swift            ← Shared constants (subsystem, audio params)
│   ├── Info.plist                  ← LSUIElement, NSMicrophoneUsageDescription
│   ├── Lyre.entitlements           ← Audio Input
│   ├── Assets.xcassets/            ← App icon, tray icons
│   ├── Audio/
│   │   ├── PermissionManager.swift
│   │   ├── AudioCaptureManager.swift
│   │   ├── AudioMixer.swift
│   │   └── RecordingManager.swift  ← State machine + AVAssetWriter encoding
│   ├── Recording/
│   │   └── RecordingsStore.swift   ← File scanning, metadata, bulk delete
│   ├── Network/
│   │   ├── APIClient.swift         ← Actor, all endpoints, injectable URLSession
│   │   └── UploadManager.swift     ← 3-step upload flow
│   ├── Config/
│   │   └── AppConfig.swift         ← JSON persistence
│   ├── Views/
│   │   ├── RecordingsView.swift    ← List, playback, multi-select batch delete
│   │   ├── UploadView.swift        ← Upload form, folder/tag, progress
│   │   ├── SettingsView.swift      ← Server config, connection test
│   │   ├── AboutView.swift         ← Version, GitHub links
│   │   └── PermissionGuideView.swift ← Step-by-step onboarding
│   └── Utilities/
│       └── AudioPlayerManager.swift ← AVAudioPlayer wrapper
└── LyreTests/
    ├── SmokeTests.swift            ← 1 test
    ├── PermissionManagerTests.swift ← 4 tests
    ├── AudioMixerTests.swift       ← 20 tests
    ├── AudioCaptureManagerTests.swift ← 12 tests
    ├── RecordingManagerTests.swift  ← 12 tests
    ├── RecordingsStoreTests.swift   ← 10 tests
    ├── AppConfigTests.swift         ← 11 tests
    ├── KeychainHelperTests.swift    ← 9 tests
    ├── APIClientTests.swift         ← 15 tests
    ├── UploadManagerTests.swift     ← 6 tests
    └── RecordingE2ETests.swift      ← 3 E2E tests
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

- **useSearchParams() needs Suspense**: In Next.js 16, any component using `useSearchParams()` must be wrapped in a `<Suspense>` boundary, otherwise the production build fails during static page generation. This applies to both page components and shared components like Sidebar.
- **SQLite WAL mode: always checkpoint before copying**: When copying a SQLite database file, `ALTER TABLE` and other schema changes may live in the `.db-wal` file, not the main `.db` file. Always run `PRAGMA wal_checkpoint(TRUNCATE)` before `cp`, or copy all three files (`.db`, `.db-shm`, `.db-wal`) together. Copying only the `.db` file silently loses uncommitted WAL changes.
- **Production DB schema must be migrated after schema changes**: Drizzle schema changes (new columns, new tables) only affect the local dev DB when running `db:push`. The production SQLite on Railway volume is **not** auto-migrated on deploy. After any schema change, SSH into the Railway container (`railway ssh`) and run the necessary `ALTER TABLE ADD COLUMN` statements via `bun -e` (since `sqlite3` CLI is not available in the standalone image). Always run `PRAGMA wal_checkpoint(TRUNCATE)` after migration. Failure to migrate causes silent HTTP 500 errors because Drizzle generates SQL referencing columns that don't exist yet — and without try/catch the real error (`table X has no column named Y`) is swallowed by Next.js's generic 500 handler.
- **Pre-push hook must include `bun run build`**: UT, lint, and E2E alone do NOT catch TypeScript type errors that only surface during `next build` (which runs full `tsc`). ESLint doesn't flag array-index `string | undefined` narrowing issues, and E2E uses `next dev` which skips type checking. The pre-push hook order is: `test:coverage → lint → build → test:e2e`, followed by macOS UT + lint.
- **SCStream requires registering each output type separately**: Apple's `SCStream.addStreamOutput(_:type:)` must be called for **each** `SCStreamOutputType` you want to receive. Setting `capturesMicrophone = true` in `SCStreamConfiguration` enables microphone capture at the system level, but the stream only delivers microphone buffers if you also register an output handler with type `.microphone`. Without this registration, mic samples are silently discarded — the handler registered for `.audio` never sees them.
- **System audio + microphone are separate PCM streams that must be mixed**: ScreenCaptureKit delivers system audio and microphone as independent `CMSampleBuffer` streams. Simply concatenating both into the same MP3 encoder doubles the recording duration (2s recording → 4s file). The correct approach is an `AudioMixer` that buffers both sources independently and outputs their sample-by-sample average `(a + b) / 2`. The mixer also handles the single-source fallback (e.g. no mic permission) by draining the active buffer after a threshold (~100ms at 48kHz) to prevent unbounded accumulation.
