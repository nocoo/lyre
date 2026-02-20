# Changelog

All notable changes to this project will be documented in this file.

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
