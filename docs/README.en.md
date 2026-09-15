<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Lyre" width="128" height="128" />
</p>

<h1 align="center">Lyre</h1>

<p align="center">Manage recordings, transcribe speech and follow the text during playback.</p>

<p align="center">
  <a href="https://lyre.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Lyre manages audio recordings and speech transcription. Upload audio, start transcription, play recordings, inspect text and generate summaries in the browser. Its companion macOS menu bar app records microphone and system audio, then uploads files to the same service.

A single Cloudflare Worker serves the web interface and API. D1 stores recording metadata and task status; Aliyun OSS stores audio and raw transcription results. Speech recognition uses DashScope, while summaries use a separately configured model service.

## Features

- Upload audio, edit titles, descriptions and notes, and organize recordings with folders, tags, search, status filters and pagination.
- Start or repeat transcription and inspect task status. A production cron checks unfinished tasks every minute; fetching an individual job can also advance it.
- Change playback speed, seek, jump by sentence, and view or copy full text. Word timestamps enable word highlighting and click-to-seek when available.
- Generate Chinese summaries manually or enable summaries after transcription. Regeneration can include feedback.
- Export and import metadata JSON, push backups to Backy manually, or let Backy trigger a backup through a webhook.
- Record from the macOS menu bar, follow the system input or select a microphone, and upload files. Optional Teams reminders default to off on new installs, never take focus, and always require confirmation to start or stop a recording.

## Usage

### Web

The [website](https://lyre.hexly.ai) requires an identity allowed by Cloudflare Access. The operator must configure OSS and DashScope first. Summaries also require a provider, model and credentials in AI settings.

1. Upload audio and provide a title, description or folder. The web interface limits each file to 500 MiB.
2. Open the recording and start transcription manually. Finishing an upload does not start transcription automatically.
3. Once transcription completes, play the audio alongside its text, generate a summary, add notes or download the recording.

Without `DASHSCOPE_API_KEY`, the service uses mock ASR and returns example text. Real transcription and summaries require valid service configuration. The word view also needs the raw transcription result archived in OSS.

### macOS client

The client requires macOS 15 or later. See [macOS build and setup](08-development.md#macos-构建与配置) for packaging from source. Create a token under Device Tokens on the website, enter the server URL and token in the client, then grant microphone and screen/system audio recording permissions through its permissions page.

Recordings default to `~/Music/Lyre Recordings/`. After stopping, inspect and upload them in the client. System and microphone audio are recorded on separate tracks by default; upload attempts to mix them into one track while keeping the original local file.

### Metadata backups

Settings exports JSON containing recording metadata, transcripts, settings and device token hashes. Settings may contain model or Backy API keys. Audio and raw transcription objects in OSS need separate backups. Import merges or updates records by ID; see [backup and storage scope](08-development.md#备份与存储范围).

## Development

Web and Worker development require Bun and Node.js 22+, the minimum declared by the locked Wrangler package. Install dependencies and build assets in a separate development checkout:

```bash
git clone https://github.com/nocoo/lyre.git
cd lyre
bun install --frozen-lockfile
bun run build
```

The local test schema drops and recreates tables. Run it only against disposable local state:

```bash
cd apps/api
bunx wrangler d1 execute lyre-db-test --env test --local --file ../../e2e/schema.sql
cd ../..
```

Start these in separate terminals:

```bash
bun run worker:dev
```

```bash
bun run web:dev
```

The Worker uses the local-only `test` environment on port 7017. Vite runs on port 7016 and proxies `/api` to it. A local test identity is configured, so the empty interface and metadata management need no real cloud credentials. Real OSS upload and ASR have additional prerequisites in [local setup](08-development.md#本地环境).

```text
apps/web/          React pages, player and transcription views
apps/api/          Hono Worker, authentication, API and scheduled tasks
apps/macos/        SwiftUI menu bar recorder
packages/api/      Shared contracts, handlers, repositories and services
```

`bun run build` writes the web output to `apps/api/static`. `bun run typecheck` checks TypeScript; `bun run lint` checks code style. Release deploys the Worker after successful CI on main; D1 migrations are a separate step. The `test` environment is for local use, and the repository has no `deploy:test` command.

## Tests

Run from the repository root:

| Scope | Command |
| --- | --- |
| Web, Worker, shared API and development script unit tests | `bun run test` |
| Unit tests with coverage reports | `bun run test:coverage` |
| Local HTTP API integration | `bun run test:e2e` |
| Browser tests | `bun run test:e2e:bdd` |

HTTP integration uses port 7017 and browser tests use port 27016. Both apply `e2e/schema.sql`, recreating the same local test D1 state. Use a separate checkout, run them sequentially and free the ports first. Browser tests also need a web build and Chromium, installed with `bunx playwright install chromium`. Keep real service credentials out of ordinary local verification; [test setup](08-development.md#测试入口) explains the separate opt-in for live ASR tests.

macOS tests require full Xcode and macOS 15+. Run from the repository root:

```bash
bun run test:macos
```

The default command does not enable live recording. See [macOS test prerequisites](08-development.md#macos-测试前提) for toolchain setup, result locations and the separate live-recording opt-in.

## Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)
![Swift](https://img.shields.io/badge/Swift-F05138?logo=swift&logoColor=white)

| Area | Implementation |
| --- | --- |
| Web | React, Vite, React Router, SWR, Tailwind CSS, Basalt, Recharts |
| Services and data | Hono, Cloudflare Workers, D1, Drizzle ORM |
| Audio storage and transcription | Aliyun OSS, DashScope asynchronous file transcription |
| Summaries | Vercel AI SDK, @nocoo/next-ai, Markdown rendering |
| Authentication | Cloudflare Access, jose, device Bearer tokens |
| macOS | Swift, SwiftUI, ScreenCaptureKit, AVFoundation |
| Verification | Vitest, Playwright, Swift Testing, Biome, SwiftLint |

## Documentation

- [Documentation index](README.md)
- [Current development, configuration and deployment](08-development.md)
- [Backy integration](02-backy.md)
- [macOS audio pipeline design](06-macos-audio-pipeline-redesign.md)
- [Teams meeting detection](07-teams-meeting-detector.md)

## License

[MIT](../LICENSE) © 2026 Zheng Li
