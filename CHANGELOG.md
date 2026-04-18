# Changelog

## v1.6.5 (2026-04-18)

### 🚀 Features

- feat(deps): add @nocoo/next-ai, remove redundant AI SDK deps (7a6f2ff)
- feat(web): upgrade /api/live to surety standard (9c16297)
- feat(scripts): add automated release script (8a49f8a)
- feat(api): add component field to /api/live health check (c0eccac)
- feat(tokens): add rounded-card and rounded-widget utility classes (3a916c2)

### 🐛 Bug Fixes

- fix(scripts): add clean-tree check to release script (7de2607)
- fix(test): resolve TS errors in backy-service.test.ts (6354a48)
- fix(test): resolve TS errors in theme.test.ts (178c8ec)
- fix(test): resolve TS errors in proxy.test.ts (126e700)
- fix(test): resolve TS errors in oss-service.test.ts (7d0c6f7)
- fix(test): resolve TS errors in use-job-events.test.ts (75dd004)
- fix(test): resolve TS errors in jobs-repo.test.ts (5c83515)
- fix(test): resolve TS errors in job-processor.test.ts (3c8bd17)
- fix(test): resolve TS errors in job-manager.test.ts (9cf6ec4)
- fix(scripts): sync macOS version in release script (a3b0d72)
- fix(lint): remove unused eslint-disable directive in setup.ts (65f9d47)
- fix(deps): override hono to >=4.12.14 — fix GHSA-458j-xx4x-4375 (ffbf96e)
- fix(ui): skeleton use bg-secondary instead of bg-muted (f796e1d)
- fix(ui): add tabular-nums to duration displays in recording cards (f4cace6)
- fix(ui): remove shadow from non-overlay components (518750a)
- fix(components): replace border-input anti-pattern in app components (336c52d)
- fix(ui): replace anti-pattern tokens in base components (0cf8a95)
- fix(ci): 迁移到 base-ci@v2026，禁用 L2 E2E (4af4118)
- fix(deps): update next, path-to-regexp, picomatch (49219d7)
- fix(deps): update vulnerable deps + add osv-scanner.toml (511b54b)
- fix: resolve B-4 content page UI violations (93f5011)
- fix: dashboard group labels, chevron size, and breadcrumb aria per basalt B-2 spec (b09793a)
- fix: login page layout, github link, and aria-hidden per basalt spec (7eb62e1)
- fix: update stale doc paths in CHANGELOG.md (ab76ebd)
- fix: align logo assets with single-source pipeline convention (21f465f)

### 📝 Other Changes

- ci: enable typecheck in CI workflow (11dc40f)
- test(ai): update ai-service tests for next-ai migration (50799aa)
- refactor(ai): update consumers to use createAiModel from next-ai (80de230)
- refactor(ai): migrate services/ai.ts to use @nocoo/next-ai (79388c3)
- ci: enable L2 API E2E tests (ba5e003)
- chore(coverage): auto-discover test files and raise threshold to 95% (ffefc2f)
- test(proxy): add unit tests covering auth routing and redirect URL construction (0e6e40b)
- test: add bunfig.toml to scope coverage to unit-tested modules (5f50e48)
- chore(g1): add typecheck script (fad1697)
- chore: remove stale hono CVE ignores from osv-scanner.toml (51787e1)
- Revert "chore(security): ignore GHSA-458j-xx4x-4375 hono indirect via shadcn" (cc6a1ee)
- chore(security): ignore GHSA-458j-xx4x-4375 hono indirect via shadcn (4c8e119)
- chore(quality): 6DQ G1 — add --max-warnings=0 to lint (#1) (41ee14f)
- ci: migrate to nocoo/base-ci@v2026 (f0248d5)
- ci: fix .gitleaks.toml format — use flat regex list (e82ff23)
- ci: add .gitleaks.toml to allowlist test mock keys (6ad9373)
- ci: add GitHub Actions CI workflow (ccfabda)
- chore: migrate dev port 7025 → 7016 (23a549e)
- chore: bump version to 1.6.3 (dfe4487)
- refactor: move logo assets to project root per basalt B-3 spec (8226a99)
- chore: bump version to 1.6.2 (c0d0b2a)
- docs: add docs index link to README (d284cde)
- docs: add docs/README.md index (2a8b87a)
- docs: renumber active docs (03→01, 04→02) (0c55332)
- chore: archive stale planning docs (3e86c17)
- docs: clarify apple development signing (2e17a3a)


All notable changes to this project will be documented in this file.

## [v1.6.0] - 2026-03-06

### Changed

- Upgrade React and React DOM from 19.2.3 to 19.2.4 (DoS mitigations for Server Actions/Components)
- Upgrade AI SDK: `ai` 6.0.97→6.0.116, `@ai-sdk/anthropic` 3.0.46→3.0.58, `@ai-sdk/openai` 3.0.30→3.0.41
- Upgrade Tailwind CSS and PostCSS plugin from 4.2.0 to 4.2.1
- Upgrade lucide-react from ^0.575.0 to ^0.577.0
- Upgrade ESLint 9.39.2→9.39.3, @types/bun 1.3.9→1.3.10, @types/node 20.19.33→20.19.37

### Improved

- Extract theme pure functions to `theme-utils.ts` for better testability
- Extract sidebar nav utilities and rewrite tests to use real imports
- Deduplicate `hashString`, keep single source in `utils.ts`
- Export matcher pattern from `proxy.ts` so tests import real source
- Consolidate unit tests with `test.each` for better maintainability

### Fixed

- Keep `config.matcher` as static literal for Next.js build compatibility

### Docs

- Update CLAUDE.md: web tech stack, project structure, macOS structure with test counts
- Update README with monorepo structure, AI/charts stack, and new features
- Add missing v1.5.3 changelog entry

## [v1.5.5] - 2026-03-02

### Added

- Bidirectional Backy integration: Pull direction (Backy → Lyre webhook → auto-push backup)
- `POST /api/backy/pull` webhook endpoint for Backy-triggered automatic backups (authenticated via `X-Webhook-Key` header)
- `HEAD /api/backy/pull` health check endpoint for verifying pull key validity
- Pull Key CRUD: `POST/DELETE /api/settings/backy/pull-key` for generating and revoking pull keys
- `findByKeyAndValue()` method on `settingsRepo` for reverse-lookup (pull key → userId)
- Pull Webhook Settings UI card: generate/regenerate/revoke key, copy webhook URL/key, curl example
- E2E tests for pull key CRUD and pull webhook endpoints (12 new tests)
- Unit tests for pull key service functions and `findByKeyAndValue` (18 new tests)
- Pull webhook documentation in `docs/02-backy.md` with full API reference and architecture diagrams

### Changed

- `GET /api/settings/backy` response now includes `hasPullKey` and `pullKey` fields
- Backy docs updated to reflect bidirectional architecture (Push + Pull)

## [v1.5.4] - 2026-02-28

### Added

- Server-Sent Events (SSE) infrastructure for real-time job status updates (`/api/jobs/events`)
- `JobManager` server-side polling engine that tracks ASR jobs and broadcasts state changes
- `JobEventHub` singleton for fan-out SSE delivery to connected clients
- `useJobEvents` client-side React hook for subscribing to SSE job events
- Recordings list page auto-refreshes when transcription jobs complete (via SSE)

### Changed

- Recording detail page uses SSE instead of client-side polling for job status updates
- Job processing logic extracted into dedicated `job-processor` service for better separation of concerns

### Fixed

- Added missing `sizes` prop to cover `Image` in cassette player to improve page performance

## [v1.5.3] - 2026-02-28

### Changed

- Migrated tag system from legacy JSON column (`recordings.tags`) to normalized `recording_tags` join table across all layers (API, repository, UI)
- Native macOS app rewritten from Tauri/Rust to pure Swift/SwiftUI (`MenuBarExtra` menu bar app)
- Audio encoding extracted into dedicated `AudioEncoder` class (AVAssetWriter M4A/AAC)
- Auth token storage migrated from plaintext JSON to macOS Keychain
- Upload uses streaming file transfer instead of loading entire recording into memory

### Added

- macOS app: file system watcher for auto-refreshing recordings list
- macOS app: multi-select batch delete in recordings view
- macOS app: input device memory persisted across app restarts
- macOS app: metadata fetch error surfacing in upload sheet UI
- macOS app: CoreAudio listener for auto-refreshing device list on hardware changes

### Fixed

- Tag associations now written to `recording_tags` join table on recording creation
- `@MainActor` added to `UploadManager` for safe UI state updates
- Audio mixer max buffer size cap to prevent unbounded memory growth
- Encoder finalization on stream error to prevent file corruption
- GLM model updated from `glm-4.5` to `glm-4.7`

## [v1.5.2] - 2026-02-23

### Added

- Remote backup history panel in Settings: displays total backup count and recent entries from Backy
- `GET /api/settings/backy/history` endpoint proxies to Backy webhook for backup history retrieval
- `fetchBackyHistory()` service function with full error handling (HTTP errors, network failures)
- Auto-refresh: history loads on page mount when configured, and refreshes after successful push
- Manual refresh button for remote backup history
- Backy integration docs (`docs/02-backy.md`): webhook API reference, architecture, and integration guide

### Changed

- BackySection layout: remote history panel moved below config/actions (stacked layout)
- History entries displayed as responsive grid cards with environment badge, tag, file size, and relative timestamp

## [v1.5.1] - 2026-02-23

### Added

- Remote backup integration with Backy: push full JSON backups to an off-site webhook
- Backy configuration UI in Settings: webhook URL and API key inputs with save, test connection, and push actions
- Test Connection button sends HEAD request to verify Backy webhook reachability
- Environment badge (dev/prod) displayed in the Remote Backup section header
- Full data backup export and import (JSON) with all user data (recordings, transcriptions, folders, tags, jobs, settings)
- Detailed request/response view after Backy push for debugging (URL, method, tag, file size, backup stats, HTTP status, response body)

### Changed

- Backy credentials (webhook URL, API key) stored in database settings instead of hardcoded constants
- Backy push tag includes dynamic stats: version, date, recording/transcription/folder/tag counts
- Dev server script injects `NODE_EXTRA_CA_CERTS` for mkcert TLS trust

### Fixed

- Graceful fetch failure handling in Backy push (catches DNS, TLS, connection errors)
- Node.js FormData compatibility using Blob append instead of File constructor
- Strict TypeScript: concrete `ImportCounts` interface for backup import response

## [v1.5.0] - 2026-02-22

### Added

- Collapsible sidebar groups (General, Recordings, Settings) with animated expand/collapse using CSS `grid-template-rows` transition
- Folder CRUD in sidebar: create, rename, delete folders with icon picker (lucide icons)
- Folder filtering on recordings page via URL search param `?folder=`
- Settings split into 3 sub-pages: General (`/settings`), AI Settings (`/settings/ai`), Device Tokens (`/settings/tokens`)
- Settings sidebar group with sub-navigation items
- Collapsed sidebar shows settings items as icon-only buttons with tooltips
- Device tokens system for programmatic API access (generate, list, revoke tokens)
- Bearer token authentication for API endpoints
- Tauri macOS menu bar app with audio recording, microphone selection, and tray UI
- Unit tests for sidebar navigation structure and route matching logic
- E2E tests for settings sub-pages and settings API endpoints

### Changed

- Sidebar refactored to `NavGroupSection` pattern (inspired by basalt template)
- Recordings group defaults to expanded; Settings group auto-expands when on settings pages
- `AiSettingsSection` and `DeviceTokensSection` components no longer use `lg:col-span-2` (standalone pages)

### Fixed

- Dockerfile paths updated for monorepo standalone output

## [v1.1.0] - 2026-02-21

### Added

- AI-powered recording summaries with streaming generation and markdown rendering
- Multi-provider AI service with OpenAI and Anthropic SDK support (provider registry with `sdkType`)
- AI configuration UI in settings with model presets and custom provider fields
- Auto-summarize recordings after transcription completes
- AI summary card on recording detail page
- Tags and folders system with full CRUD API routes
- Notes, tags, folder assignment, and `recordedAt` fields on recordings
- Download URL API endpoint for recordings
- File `recordedAt` date sent from `file.lastModified` on upload
- `recordedAt` date shown in recording card footer
- Detail page: download button, notes editor, tag picker, folder selector, recorded-at date picker
- Detail page restructured to 3-row 2/3+1/3 grid layout with embedded player
- Title rename in recording properties panel
- Real LLM E2E tests with `.env.e2e` credentials setup (graceful skip when absent)
- E2E tests for tags, folders, AI settings, summarize API, and custom providers

### Changed

- Transcript view toggle moved into card as segment filter
- Card headers unified with consistent `h-full` height
- E2E infrastructure uses port 17025, `PLAYWRIGHT=1` auth bypass, and `.env.e2e` loading
- Settings UI redesigned with model presets and custom provider fields
- Settings API updated for custom provider support with `sdkType` validation

### Fixed

- Append `/v1` to GLM and MiniMax Anthropic-compatible base URLs
- Clear AI config before unconfigured summarize E2E test

## [v1.0.0] - 2026-02-20

### Added

- Audio upload with direct-to-OSS presigned upload and progress tracking (up to 500 MB)
- ASR transcription powered by Aliyun DashScope with async job and real-time status polling
- Custom audio player with play/pause, skip, variable speed, and progress seeking
- Transcript viewer with sentence view synced to audio playback and full-text view
- Word-level karaoke with lazy-loaded word timestamps, clickable words, and real-time highlighting
- One-click transcript copy to clipboard
- Recording management with full CRUD, search, status filter, pagination, and sorting
- Google OAuth authentication with email allowlist and reverse proxy support
- Local SQLite database via Drizzle ORM with zero external database dependency
- Docker multi-stage build optimized for Railway deployment
- Scroll-to-top floating action button across all pages
- App version display in sidebar and `/api/live` health endpoint
- Seed script for demo data
- Unit tests, E2E tests, and coverage checks with Husky pre-commit/pre-push hooks
