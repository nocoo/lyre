<p align="center">
  <img src="apps/web/public/logo-80.png" alt="Lyre Logo" width="80" height="80">
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

<p align="center">
  <img src="https://s.zhe.to/dcd0e6e42358/20260222/968a964f-c888-4e27-955e-8f52e3df0f80.jpg" alt="Lyre Preview" width="720">
</p>

---

## ✨ Features

- 🎙️ **Audio Upload** — Direct-to-OSS presigned upload with progress tracking (up to 500 MB)
- 📝 **ASR Transcription** — Powered by Aliyun DashScope, async job with real-time SSE status updates
- 🤖 **AI Summaries** — Multi-provider LLM summarization (OpenAI, Anthropic) with streaming markdown
- 🎵 **Audio Player** — Custom player with play/pause, skip, variable speed, and progress seeking
- 💬 **Transcript Viewer** — Sentence view synced to audio playback, full-text view, one-click copy
- 🔤 **Word-Level Karaoke** — Lazy-loaded word timestamps, clickable words for seeking, real-time highlighting
- 🔍 **Recording Management** — Full CRUD, search, folders, tags, status filter, pagination, and sorting
- 📊 **Dashboard** — Charts and statistics for recording activity overview
- 🔒 **Google OAuth** — Email allowlist-based access control with reverse proxy support
- 🗄️ **Local SQLite** — All data stored locally via Drizzle ORM, zero external database dependency
- 💾 **Remote Backup** — Bidirectional Backy integration (push + pull webhook)
- 🖥️ **macOS App** — Native Swift/SwiftUI menu bar app for meeting recording (mic + system audio)
- 🐳 **Docker Ready** — Multi-stage Dockerfile optimized for Railway deployment

## 🚀 Quick Start

### 1️⃣ Install Dependencies

```bash
# Requires Bun: https://bun.sh
bun install
```

### 2️⃣ Configure Environment Variables

```bash
cp apps/web/.env.example apps/web/.env.local
```

You'll need API keys from **Google Cloud** (OAuth) and **Aliyun** (OSS + ASR).

> 📖 **[Deployment Guide](docs/01-deployment.md)** — Step-by-step instructions for obtaining all API keys, configuring each service, and deploying to production.
>
> 📚 **[All Documentation](docs/README.md)** — Full docs index including deployment, backup integration, and archived planning docs.

### 3️⃣ Initialize Database

```bash
bun run db:push
```

### 4️⃣ Start Development Server

```bash
bun dev
```

Open your browser 👉 [http://localhost:7025](http://localhost:7025)

## 📁 Project Structure

```
lyre/
├── 📂 apps/
│   ├── 📂 web/                    # Next.js web app (@lyre/web)
│   │   ├── 📂 src/
│   │   │   ├── 📂 app/            # App Router pages & API routes
│   │   │   ├── 📂 components/     # React components (layout, ui, features)
│   │   │   ├── 📂 db/             # Schema & repositories (Drizzle ORM)
│   │   │   ├── 📂 services/       # Backend services (AI, ASR, OSS, backup)
│   │   │   ├── 📂 hooks/          # React hooks (SSE, mobile detection)
│   │   │   ├── 📂 lib/            # Types, utils, view models
│   │   │   └── 📂 __tests__/      # Unit tests & E2E tests
│   │   ├── 📂 scripts/            # Seed, coverage, E2E runner
│   │   ├── 📂 database/           # SQLite database files (gitignored)
│   │   └── 📂 public/             # Static assets (logos, favicons)
│   └── 📂 macos/                  # Native Swift/SwiftUI menu bar app
│       ├── 📂 Lyre/               # Swift source code
│       └── 📂 LyreTests/          # Unit + E2E tests (Swift Testing)
├── 📂 packages/                   # Shared packages placeholder
├── Dockerfile                     # Multi-stage Docker build (Bun)
└── package.json                   # Root workspace config
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
| 🤖 AI | Vercel AI SDK (OpenAI + Anthropic) |
| ☁️ Storage | Aliyun OSS (zero-SDK, custom V1 signature) |
| 🗣️ ASR | Aliyun DashScope (`qwen3-asr-flash-filetrans`) |
| 📊 Charts | Recharts (dashboard visualizations) |
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
>
> See **[Deployment Guide](docs/01-deployment.md)** for full Docker and Railway deployment instructions.

## 📄 License

[MIT](LICENSE) © 2026
