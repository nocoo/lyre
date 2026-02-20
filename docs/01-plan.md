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
| `/api/jobs/[id]`                   | GET    | Poll ASR job status             |
| `/api/upload/presign`              | POST   | Get OSS presigned upload URL    |
| `/api/settings`                    | GET    | Get user settings               |
| `/api/settings/[key]`              | PUT    | Update a setting                |

---

## Phase 1: Scaffold + Infrastructure

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `chore: initialize next.js 16 project with bun` | pending |
| 2  | `chore: configure typescript strict mode` | pending |
| 3  | `chore: configure eslint` | pending |
| 4  | `chore: add basalt design tokens` | pending |
| 5  | `chore: configure shadcn/ui` | pending |
| 6  | `chore: add base shadcn/ui components` | pending |
| 7  | `chore: add google fonts and root layout` | pending |
| 8  | `chore: configure next.config.ts` | pending |
| 9  | `chore: add bun test infrastructure` | pending |
| 10 | `chore: add husky git hooks` | pending |
| 11 | `chore: add e2e test runner script` | pending |
| 12 | `chore: add coverage check script` | pending |

## Phase 2: Auth + Layout

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add nextauth v5 google oauth config` | pending |
| 2  | `feat: add auth provider wrapper` | pending |
| 3  | `feat: add proxy middleware for auth guard` | pending |
| 4  | `feat: add badge login page` | pending |
| 5  | `feat: add theme toggle component` | pending |
| 6  | `feat: add sidebar component` | pending |
| 7  | `feat: add app shell layout` | pending |
| 8  | `test: add auth and layout component tests` | pending |

## Phase 3: Mock UI + Test Baseline

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add recording types and mock data` | pending |
| 2  | `feat: add recordings list view model` | pending |
| 3  | `test: add recordings list view model tests` | pending |
| 4  | `feat: add recording detail view model` | pending |
| 5  | `test: add recording detail view model tests` | pending |
| 6  | `feat: add recording card component` | pending |
| 7  | `feat: add recordings list page` | pending |
| 8  | `feat: add audio player component` | pending |
| 9  | `feat: add transcript viewer component` | pending |
| 10 | `feat: add recording detail page` | pending |
| 11 | `feat: add settings page` | pending |
| 12 | `test: add page render tests and raise coverage baseline` | pending |
| 13 | `feat: add mock api routes for recordings` | pending |
| 14 | `feat: add health check api route` | pending |
| 15 | `test: add e2e tests for mock api routes` | pending |

## Phase 4: Database Layer

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add drizzle orm schema` | pending |
| 2  | `feat: add database connection management` | pending |
| 3  | `feat: add user repository` | pending |
| 4  | `feat: add recording repository` | pending |
| 5  | `feat: add transcription and job repositories` | pending |
| 6  | `test: add repository unit tests` | pending |

## Phase 5: Upload + Recording CRUD

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add oss service` | pending |
| 2  | `test: add oss service unit tests` | pending |
| 3  | `feat: wire api routes to real database` | pending |
| 4  | `feat: add upload presign api route` | pending |
| 5  | `feat: add upload dialog component` | pending |
| 6  | `feat: add recording play url api route` | pending |
| 7  | `test: update e2e tests for real database` | pending |

## Phase 6: ASR Integration

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `feat: add asr service` | pending |
| 2  | `test: add asr service unit tests` | pending |
| 3  | `feat: add transcribe api route` | pending |
| 4  | `feat: add job polling api route` | pending |
| 5  | `feat: add asr raw result archival to oss` | pending |
| 6  | `feat: wire transcription ui to real api` | pending |

## Phase 7: Deploy

| #  | Commit | Status |
| -- | ------ | ------ |
| 1  | `chore: add dockerfile` | pending |
| 2  | `chore: add env example file` | pending |
| 3  | `chore: add seed script for demo data` | pending |
