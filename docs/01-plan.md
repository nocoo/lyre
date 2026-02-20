# Lyre - Implementation Plan

Audio recording management and transcription platform.
Users upload mp3 recordings to Aliyun OSS, transcribe via DashScope ASR API,
results stored in local SQLite.

## Tech Stack

| Layer          | Choice                              |
| -------------- | ----------------------------------- |
| Runtime        | Bun 1.3.x                          |
| Framework      | Next.js 16 (App Router, standalone) |
| Auth           | NextAuth v5 + Google OAuth          |
| Database       | SQLite (bun:sqlite) + Drizzle ORM   |
| File Storage   | Aliyun OSS (presigned upload)       |
| ASR            | Aliyun DashScope (qwen3-asr-flash)  |
| UI             | shadcn/ui + Tailwind v4 + basalt    |
| Testing        | bun:test (UT) + ESLint + E2E (HTTP) |
| Deployment     | Railway + Docker                    |
| Dev Port       | 7025 (dev), 7026 (E2E)             |

## Architecture

```
View (React pages/components)
  │ consumes
ViewModel (src/lib/*-vm.ts, pure functions)
  │
API Routes (src/app/api/)
  │ calls
Repository (src/db/repositories/) ←→ SQLite
Service (src/services/)           ←→ OSS / DashScope
```

## Database Schema

```
users
  id text PK (UUID)
  email text NOT NULL UNIQUE
  name text
  avatar_url text
  created_at integer
  updated_at integer

recordings
  id text PK (UUID)
  user_id text FK → users.id
  title text NOT NULL
  description text
  file_name text NOT NULL
  file_size integer
  duration real (seconds)
  format text
  sample_rate integer
  oss_key text NOT NULL
  tags text (JSON array)
  status text NOT NULL (uploaded | transcribing | completed | failed)
  created_at integer
  updated_at integer

transcription_jobs
  id text PK (UUID)
  recording_id text FK → recordings.id
  task_id text NOT NULL (DashScope)
  request_id text
  status text NOT NULL (PENDING | RUNNING | SUCCEEDED | FAILED)
  submit_time text
  end_time text
  usage_seconds integer
  error_message text
  result_url text
  created_at integer
  updated_at integer

transcriptions
  id text PK (UUID)
  recording_id text FK → recordings.id (UNIQUE)
  job_id text FK → transcription_jobs.id
  full_text text NOT NULL
  sentences text NOT NULL (JSON)
  language text
  created_at integer
  updated_at integer

settings
  user_id text FK → users.id  ─┐ composite PK
  key text NOT NULL            ─┘
  value text NOT NULL
  updated_at integer
```

## API Routes

| Route                              | Method | Purpose                         |
| ---------------------------------- | ------ | ------------------------------- |
| `/api/auth/[...nextauth]`          | *      | NextAuth handler                |
| `/api/live`                        | GET    | Health check                    |
| `/api/recordings`                  | GET    | List user recordings (paginated)|
| `/api/recordings`                  | POST   | Create recording record         |
| `/api/recordings/[id]`             | GET    | Recording detail + transcription|
| `/api/recordings/[id]`             | PUT    | Update title, description, tags |
| `/api/recordings/[id]`             | DELETE | Delete recording + OSS file     |
| `/api/recordings/[id]/transcribe`  | POST   | Trigger ASR job                 |
| `/api/recordings/[id]/play-url`    | GET    | Fresh OSS signed URL            |
| `/api/recordings/[id]/words`       | GET    | Lazy-load word-level data       |
| `/api/jobs/[id]`                   | GET    | Poll ASR job status             |
| `/api/upload/presign`              | POST   | Get OSS presigned upload URL    |
| `/api/settings`                    | GET    | Get user settings               |
| `/api/settings/[key]`              | PUT    | Update a setting                |

---

## Phase 1: Scaffold + Infrastructure

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `chore: initialize next.js 16 project with bun` | done |
| 2  | `chore: configure typescript strict mode` | done |
| 3  | `chore: configure eslint` | done |
| 4  | `chore: add basalt design tokens` | done |
| 5  | `chore: configure shadcn/ui` | done |
| 6  | `chore: add base shadcn/ui components` | done |
| 7  | `chore: add google fonts and root layout` | done |
| 8  | `chore: configure next.config.ts` | done |
| 9  | `chore: add bun test infrastructure` | done |
| 10 | `chore: add husky git hooks` | done |
| 11 | `chore: add e2e test runner script` | done |
| 12 | `chore: add coverage check script` | done |

## Phase 2: Auth + Layout

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add nextauth v5 google oauth config` | done |
| 2  | `feat: add auth provider wrapper` | done |
| 3  | `feat: add proxy middleware for auth guard` | done |
| 4  | `feat: add badge login page` | done |
| 5  | `feat: add theme toggle component` | done |
| 6  | `feat: add sidebar component` | done |
| 7  | `feat: add app shell layout` | done |
| 8  | `test: add auth and layout component tests` | done |

## Phase 3: Mock UI + Test Baseline

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add recording types and mock data` | done |
| 2  | `feat: add recordings list view model` | done |
| 3  | `test: add recordings list view model tests` | done |
| 4  | `feat: add recording detail view model` | done |
| 5  | `test: add recording detail view model tests` | done |
| 6  | `feat: add recording card component` | done |
| 7  | `feat: add recordings list page` | done |
| 8  | `feat: add audio player component` | done |
| 9  | `feat: add transcript viewer component` | done |
| 10 | `feat: add recording detail page` | done |
| 11 | `feat: add settings page` | done |
| 12 | `test: raise coverage baseline to ≥90%` | done |
| 13 | `feat: add mock api routes for recordings` | done |
| 14 | `feat: add health check api route` | done (phase 1) |
| 15 | `test: add e2e tests for mock api routes` | done |

## Phase 4: Database Layer

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add drizzle orm schema` | done |
| 2  | `feat: add database connection management` | done |
| 3  | `feat: add user repository` | done |
| 4  | `feat: add recording repository` | done |
| 5  | `feat: add transcription and job repositories` | done |
| 6  | `test: add repository unit tests` | done |

## Phase 5: Upload + Recording CRUD

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add oss service` | done |
| 2  | `test: add oss service unit tests` | done |
| 3  | `feat: wire api routes to real database` | done |
| 4  | `feat: add upload presign and play url api routes` | done |
| 5  | `feat: add upload dialog and wire recordings page to api` | done |
| 6  | `test: rewrite e2e tests for real database` | done |
| 7  | `fix: wire recording detail page to real api and extract audio duration` | done |
| 8  | `feat: add recording delete with oss cleanup and confirmation dialog` | done |

## Phase 6: ASR Integration

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add asr service with types, mock provider, and result parser` | done |
| 2  | `feat: add transcribe trigger and job poll api routes with mock asr provider` | done |
| 3  | `feat: wire transcribe button and job polling to recording detail page` | done |
| 4  | `test: add e2e tests for asr transcription flow and fix re-transcribe unique constraint` | done |
| 5  | `feat: implement real dashscope asr provider with unit tests` | done |
| 6  | `fix: use file_url (singular) for qwen3-asr-flash-filetrans api` | done |
| 7  | `feat: add safeFetch with curl fallback for tls-restricted environments` | done |
| 8  | `fix: add missing findActiveSentenceIndex import in transcript-viewer` | done |
| 9  | `feat: display asr model name and estimated cost in job details` | done |
| 10 | `fix: smooth progress bar animation using requestAnimationFrame instead of ontimeupdate` | done |
| 11 | `fix: pause job polling in background tabs and re-poll on visibility change` | done |
| 12 | `feat: enable word-level timestamps in asr submit request` | done |
| 13 | `feat: add word-level api route, types, vm logic, and unit tests` | done |
| 14 | `fix: resolve exactOptionalPropertyTypes violations in api routes and services` | done |
| 15 | `feat: wire word-level karaoke ui into transcript viewer` | done |

## Phase 7: Deploy

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `chore: add dockerfile` | pending |
| 2  | `chore: add env example file` | pending |
| 3  | `chore: add seed script for demo data` | pending |
