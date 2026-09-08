# Lyre 文档

[中文 README](../README.md) · [English README](README.en.md)

当前命令、环境与数据范围以[开发与运行说明](08-development.md)为准；其他章节保留部署背景和设计过程。

## Active

| # | Document | Description |
|---|----------|-------------|
| 08 | [当前开发与运行说明](08-development.md) | 当前入口、配置、测试前提、资料范围与部署 |
| 01 | [Deployment Guide](01-deployment.md) | Cloudflare Worker + D1 + Vite SPA deployment via Wrangler |
| 02 | [Backy Remote Backup](02-backy.md) | Push backups and trigger new exports through a pull webhook |
| 04 | [Quality Upgrade Plan](04-quality-upgrade-plan.md) | L1/L2/L3/G1/G2 quality gates upgrade plan (vs dove) |
| 06 | [macOS Audio Pipeline Redesign](06-macos-audio-pipeline-redesign.md) | Replace app-level sample-mixing with AVAssetWriter dual-track to fix mic time-compression |
| 07 | [Teams Meeting Detector](07-teams-meeting-detector.md) | Detect Microsoft Teams meeting start/end and prompt user to start/stop recording (Teams-only, no new permissions) |

## Archive

Completed planning documents preserved for historical reference.

| Document | Description |
|----------|-------------|
| [01-plan.md](archive/01-plan.md) | Initial build plan (Phase 1-7, all done) |
| [02-ai-summary.md](archive/02-ai-summary.md) | AI summary feature plan (all phases done) |
| [03-cf-worker-migration-plan.md](archive/03-cf-worker-migration-plan.md) | Next.js → Cloudflare Workers + Vite migration plan (all waves done) |
| [05-macos-native-swift.md](archive/05-macos-native-swift.md) | macOS native Swift rewrite plan (all phases done) |
