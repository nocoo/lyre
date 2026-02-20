<p align="center">
  <img src="public/logo-80.png" alt="Lyre Logo" width="80" height="80">
</p>

<h1 align="center">Lyre</h1>

<p align="center">
  <strong>Audio recording management and transcription platform</strong><br>
  Upload · Transcribe · Explore
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js">
  <img src="https://img.shields.io/badge/TypeScript-5-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/SQLite-local-green" alt="SQLite">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## ✨ Features

- 🎙️ **Audio Upload** — Direct-to-OSS presigned upload with progress tracking (up to 500 MB)
- 📝 **ASR Transcription** — Powered by Aliyun DashScope, async job with real-time status polling
- 🎵 **Audio Player** — Custom player with play/pause, skip, variable speed, and progress seeking
- 💬 **Transcript Viewer** — Sentence view synced to audio playback, full-text view, one-click copy
- 🔤 **Word-Level Karaoke** — Lazy-loaded word timestamps, clickable words for seeking, real-time highlighting
- 🔍 **Recording Management** — Full CRUD, search, status filter, pagination, and sorting
- 🔒 **Google OAuth** — Email allowlist-based access control with reverse proxy support
- 🗄️ **Local SQLite** — All data stored locally via Drizzle ORM, zero external database dependency
- 🐳 **Docker Ready** — Multi-stage Dockerfile optimized for Railway deployment

## 🚀 Quick Start

### 1️⃣ Install Dependencies

```bash
# Requires Bun: https://bun.sh
bun install
```

### 2️⃣ Configure Environment Variables

```bash
# Copy the example config
cp .env.example .env.local
```

Edit `.env.local` with your values:

```bash
# Google OAuth (from Google Cloud Console)
# https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret

# NextAuth secret (generate: openssl rand -base64 32)
AUTH_SECRET=your-generated-secret-here

# Allowed login emails (comma-separated)
ALLOWED_EMAILS=your-email@gmail.com

# Aliyun OSS for audio storage
OSS_ACCESS_KEY_ID=your-oss-access-key-id
OSS_ACCESS_KEY_SECRET=your-oss-access-key-secret
OSS_BUCKET=lyre
OSS_REGION=oss-cn-beijing
OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com

# Aliyun DashScope for ASR (omit to use mock provider)
DASHSCOPE_API_KEY=your-dashscope-api-key
```

> 💡 **Tip**: Set Google OAuth callback URL to `http://localhost:7025/api/auth/callback/google`

### 3️⃣ Initialize Database

```bash
# Create database and apply schema
bun run db:push
```

The database file is created at `database/lyre.db` (gitignored).

### 4️⃣ Start Development Server

```bash
bun dev
```

Open your browser 👉 [http://localhost:7025](http://localhost:7025)

## 📁 Project Structure

```
lyre/
├── 📂 database/                  # SQLite database files (gitignored)
├── 📂 public/                    # Static assets (logos, favicons)
├── 📂 scripts/                   # Seed, coverage, E2E runner
├── 📂 src/
│   ├── 📂 app/                   # Next.js App Router pages & API routes
│   │   ├── 📂 api/               # REST API endpoints
│   │   ├── login/                # OAuth login page
│   │   ├── recordings/           # Recording list & detail pages
│   │   └── settings/             # App settings page
│   ├── 📂 components/            # React components
│   │   ├── 📂 layout/            # App shell, sidebar, breadcrumbs
│   │   ├── 📂 ui/                # shadcn/ui primitives
│   │   ├── audio-player.tsx      # Custom audio player
│   │   ├── transcript-viewer.tsx # Transcript display & karaoke
│   │   └── upload-dialog.tsx     # Audio upload with progress
│   ├── 📂 db/                    # Schema & repositories (Drizzle ORM)
│   ├── 📂 services/              # OSS & ASR service layer
│   ├── 📂 lib/                   # Types, utils, view models
│   └── 📂 __tests__/             # Unit tests & E2E tests
├── Dockerfile                    # Multi-stage Docker build (Bun)
├── drizzle.config.ts             # Drizzle ORM configuration
└── next.config.ts                # Next.js configuration
```

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| ⚡ Runtime | Bun |
| 🖥️ Framework | Next.js 16 (App Router, Standalone) |
| 📝 Language | TypeScript 5 (Strict) |
| 🗄️ Database | SQLite + Drizzle ORM |
| 🎨 UI | shadcn/ui + Radix UI + Tailwind CSS v4 |
| 🔐 Auth | NextAuth v5 + Google OAuth |
| ☁️ Storage | Aliyun OSS (zero-SDK, custom V1 signature) |
| 🗣️ ASR | Aliyun DashScope (`qwen3-asr-flash-filetrans`) |
| 🐳 Deploy | Docker (multi-stage, Bun runtime) → Railway |

## 📋 Common Commands

| Command | Description |
|---|---|
| `bun dev` | Start development server (port 7025) |
| `bun run build` | Production build |
| `bun run lint` | Run ESLint |
| `bun run test` | Run unit tests |
| `bun run test:coverage` | Run tests with coverage check |
| `bun run test:e2e` | Run E2E tests |
| `bun run db:push` | Apply schema to database |
| `bun run db:studio` | Open Drizzle Studio |

## 🔧 Database Management

### Override Database Path

```bash
# Default path
database/lyre.db

# For Railway deployment (with volume mount at /data)
LYRE_DB=/data/lyre.db
```

### Use Drizzle Studio

```bash
bun run db:studio
```

> 💡 **Tip**: Drizzle Studio opens a web UI for browsing and editing database records.

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t lyre .

# Run with environment variables
docker run -p 7025:7025 \
  -v lyre-data:/data \
  -e LYRE_DB=/data/lyre.db \
  -e GOOGLE_CLIENT_ID=... \
  -e AUTH_SECRET=... \
  lyre
```

> ⚠️ **Important**: Mount a persistent volume at `/data` for SQLite database durability.

## 📄 License

[MIT](LICENSE) © 2026
