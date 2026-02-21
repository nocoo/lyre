# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-02-21

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

## [1.1.0] - 2026-02-21

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

## [1.0.0] - 2026-02-20

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
