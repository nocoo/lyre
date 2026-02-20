# Lyre - Project Guide

Audio recording management and transcription platform with word-level karaoke playback.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Next.js 16 (App Router, standalone output)
- **Language**: TypeScript 5 (strict)
- **Database**: SQLite via Drizzle ORM (`database/lyre.db`, override with `LYRE_DB`)
- **UI**: shadcn/ui + Radix UI + Tailwind CSS v4 (utility classes only, no CSS modules)
- **Icons**: `lucide-react` (the only icon library — do not introduce others)
- **Auth**: NextAuth v5 + Google OAuth with email allowlist
- **Storage**: Aliyun OSS (zero-SDK, custom V1 signature)
- **ASR**: Aliyun DashScope (`qwen3-asr-flash-filetrans`)
- **Path alias**: `@/*` → `./src/*`

## Key Commands

```bash
bun dev                # Start dev server (port 7025)
bun run build          # Production build
bun run test           # Run unit tests
bun run test:coverage  # Run tests with coverage check
bun run test:e2e       # Run E2E tests
bun run lint           # Run ESLint
bun run db:push        # Apply schema to database
bun run db:studio      # Open Drizzle Studio
```

## Git Hooks (Husky)

- **pre-commit**: `bun run test && bun run lint`
- **pre-push**: `bun run test:coverage && bun run lint && bun run test:e2e`

All code must pass UT + lint before commit. Coverage + E2E are enforced before push.

## Architecture Notes

- **Scrollable container**: The app's main scrollable element lives in `src/components/layout/app-shell.tsx` — a `<div>` with `overflow-y-auto` inside the floating island content area. Scroll-to-top FAB is attached here.
- **Sonner toast**: `<Toaster />` component exists at `src/components/ui/sonner.tsx` but is NOT mounted in root layout. Must add to `src/app/layout.tsx` if toast notifications are needed.
- **ASR mock**: Set `DASHSCOPE_API_KEY` to empty or omit it entirely to use the mock ASR provider. E2E tests unset this key to force mock mode.

## Version Management

Version is managed in **one place**: `package.json` → `version` field.

- `src/lib/version.ts` imports `package.json` at build time and exports `APP_VERSION`
- Sidebar displays the version badge (in `src/components/layout/sidebar.tsx`)
- `/api/live` endpoint returns the version in its JSON response

### How to bump version

1. Update `version` in `package.json`
2. Update the fallback string in `src/app/api/live/route.ts` to match
3. Create a git tag: `git tag v<version>`
4. Push tag: `git push origin v<version>`
5. Create GitHub release: `gh release create v<version> --generate-notes`

## Project Structure

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

## Retrospective

_(Record lessons learned from mistakes here)_
