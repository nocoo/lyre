# Changelog

All notable changes to this project will be documented in this file.

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

## [v1.5.2] - 2026-02-23

### Added

- Remote backup history panel in Settings: displays total backup count and recent entries from Backy
- `GET /api/settings/backy/history` endpoint proxies to Backy webhook for backup history retrieval
- `fetchBackyHistory()` service function with full error handling (HTTP errors, network failures)
- Auto-refresh: history loads on page mount when configured, and refreshes after successful push
- Manual refresh button for remote backup history
- Backy integration docs (`docs/04-backy.md`): webhook API reference, architecture, and integration guide

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
