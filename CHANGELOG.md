# Changelog

## v1.7.0 (2026-07-15)

### 🚀 Features

- feat(macos): add CoreAudio process-tap as primary Teams meeting signal (b562f42)

### 🐛 Bug Fixes

- fix(lint): tighten SPA import restrictions to match legacy ESLint intent (53b8ae1)
- fix(web): stop nesting Radix Checkbox inside selectable row button (afca1d4)
- fix(scripts): write package.json with tab indent in release (1be64fc)
- fix(macos): sync RecordingActionController state on recorder-side reset (63e0831)
- fix(macos): warn user when recording captured no microphone audio (85442a2)
- fix(macos): explicitly resolve auto input device before starting SCK (1c9486b)
- fix(macos): restore saved input device at app init (6db7b9d)

### 📝 Other Changes

- chore(api): drop @types/node from @lyre/api (77b3f72)
- chore(web): remove three unused shadcn wrapper files (b28778b)
- chore(deps): consolidate collapsible into radix-ui meta package (ba703ec)
- chore(deps): drop root-level hono declaration (f3cad05)
- chore(security): drop ESLint OSV ignores after biome migration (5dc2d5c)
- chore: upgrade typescript to 7.0.2 (f69a17a)
- chore: replace eslint + typescript-eslint with biome (df8f4de)
- docs(macos): clarify TeamsAudioActivityProvider nil semantics (be0724f)
- docs(macos): sync SCK-unavailable semantics with shipped code (6e516e1)
- docs(macos): add v2.0 process-tap addendum to teams detector spec (3cf745b)


## v1.6.19 (2026-07-07)

### 🚀 Features

- feat(macos): wire meeting detector into LyreApp with watcher suspend/resume off-switch (fb51a99)
- feat(macos): add MeetingPromptCoordinator with alert reentrance gate (1aebf6d)
- feat(macos): add TeamsMeetingWatcher with provider seams and v1.3 heuristic (96819f2)
- feat(macos): add MeetingDetectionSettings and Settings UI toggle (5609774)

### 🐛 Bug Fixes

- fix(macos): activate app before showing recording error alert (0ccbd23)
- fix(macos): guard NSWorkspace observer install against re-entry (1bc6ec5)

### 📝 Other Changes

- test(macos): de-flake streamLevel coordinator tests via waitUntil (0ee8e18)
- release: v1.6.18 (ef23cc7)
- chore: update CLAUDE.md retrospective with meeting detector learnings (3c500fa)
- docs(macos): record DQ manual acceptance results for teams detector (C9) (5321f7a)
- refactor(macos): extract RecordingActionController and recording seams for tray + detector (3c4d3a5)
- docs(macos): tighten Teams meeting heuristic per Phase 0 findings (v1.3) (bd2ddeb)
- chore(macos): add teams SCK window probe and phase 0 appendix (fe772b7)
- docs(macos): coordinator on MeetingEventProviding + settings owns watcher only (a5c9b88)
- docs(macos): tighten protocol seams + watcher lifecycle in detector spec (9784fee)
- docs(macos): refine teams detector spec after joint review (44024ff)
- docs: add teams-meeting-detector spec (07) (106ef27)


## v1.6.18 (2026-07-07)

### 🚀 Features

- feat(macos): wire meeting detector into LyreApp with watcher suspend/resume off-switch (3c86848)
- feat(macos): add MeetingPromptCoordinator with alert reentrance gate (95671d7)
- feat(macos): add TeamsMeetingWatcher with provider seams and v1.3 heuristic (c411fcc)
- feat(macos): add MeetingDetectionSettings and Settings UI toggle (e1b6a11)

### 🐛 Bug Fixes

- fix(macos): activate app before showing recording error alert (80e8295)
- fix(macos): guard NSWorkspace observer install against re-entry (2b79772)

### 📝 Other Changes

- chore: update CLAUDE.md retrospective with meeting detector learnings (fc31c3d)
- docs(macos): record DQ manual acceptance results for teams detector (C9) (f2db826)
- refactor(macos): extract RecordingActionController and recording seams for tray + detector (92fc471)
- docs(macos): tighten Teams meeting heuristic per Phase 0 findings (v1.3) (3a0c1c4)
- chore(macos): add teams SCK window probe and phase 0 appendix (6350f23)
- docs(macos): coordinator on MeetingEventProviding + settings owns watcher only (cf9f4cd)
- docs(macos): tighten protocol seams + watcher lifecycle in detector spec (f65cfac)
- docs(macos): refine teams detector spec after joint review (f5ae0a3)
- docs: add teams-meeting-detector spec (07) (3d600f9)


## v1.6.17 (2026-07-03)

### 🚀 Features

- feat(web): optimistic summary display + corner save badge (a9bcc52)
- feat(api): pin summary output language to Simplified Chinese (4dc20a1)

### 🐛 Bug Fixes

- fix(web): cap cassette cover art at 200px, enforce full-width fit (2432120)


## v1.6.16 (2026-07-03)

### 🚀 Features

- feat(web): Regenerate opens a one-shot feedback dialog (f573f7d)
- feat(api): /summarize accepts one-shot feedback + folds in previous summary (0156f19)

### 🐛 Bug Fixes

- fix(api): mark aiSummaryStatus=running before HTTP response returns (d3f3910)
- fix(api): don't block GET /api/jobs/:id on auto-summarize (f9689ea)
- fix(backup): include ai_summary_status/error in export + import (9d09f60)
- fix(api): persist job terminal state before auto-summarize (a5a21c8)
- fix(macos): show progress state during pre-upload preparation (59b9f49)
- fix(macos): stop pre-commit tests from triggering the Screen Recording TCC dialog (54d9ade)
- fix(ai-summary): persist status/error so auto-summary is observable (b085a64)

### 📝 Other Changes

- refactor(types): re-export lib/types from contracts to kill drift (86f4a5b)
- docs(deploy): point apply-schema at packages/api/migrations/ (7a34a76)
- chore(db): add D1 migrations directory with baseline + ai_summary columns (3de43b4)
- docs: drop docs/07 + Basalt B-6 references (ed49ee6)
- docs(macos): reconcile spec with plan on Status enum + elapsedTimer policy (78a0aea)
- docs(macos): reconcile plan + spec on conservative play button, dedupe completion visual (611d24e)
- docs(macos): plan Basalt UI upgrade rollout (Stage 1-3, 10 atomic commits) (c544835)
- docs(macos): drop ViewInspector, sharpen VoiceOver rule (948093a)
- docs(macos): tighten UI plan per review — SF Symbols, palette scope, native audit (03dd998)
- docs(macos): drop cross-platform framing from UI upgrade plan (498dde0)
- docs(macos): rewrite UI upgrade plan around macOS-native constraints (4b83a35)
- docs(macos): plan Basalt B-6 UI upgrade for the macOS app (1b12fef)


## v1.6.15 (2026-07-01)

### 🚀 Features

- feat(macos): store auth token in config.json + default server URL (a3e8946)

### 🐛 Bug Fixes

- fix(macos): downmix dual-track M4A to single track before upload (0364206)


## v1.6.14 (2026-07-01)

### 🐛 Bug Fixes

- fix(macos): enable AVAssetWriter faststart so browsers can decode M4A (7d6233f)


## v1.6.13 (2026-07-01)

### 🐛 Bug Fixes

- fix(dev): point worker:dev at [env.test] to break /api/me 401 loop (d6da321)
- fix(web): apply destructuring esbuild override to dep pre-bundling (51e2b17)

### 📝 Other Changes

- revert(playback): drop response-content-type override on play-url (19745c0)


## v1.6.12 (2026-07-01)

### 🐛 Bug Fixes

- fix(web): remove progress bar CSS transition for smooth RAF updates (bb990f9)
- fix(playback): serve M4A with audio/mp4 Content-Type (4496d18)


## v1.6.11 (2026-07-01)

### 📝 Other Changes

- chore(macos): add ad-hoc DMG build pipeline (bun run macos:dmg) (6fbf12c)


## v1.6.10 (2026-06-29)

### 🚀 Features

- feat(ai): add authType (apiKey | bearer) for custom provider (d84a3e4)


## v1.6.9 (2026-06-29)

### 🚀 Features

- feat(macos): RecordingManager dual-track wiring + protocol seam (49934b8)
- feat(macos): AudioCaptureManager raw dualTrack buffer dispatch (3ed2932)
- feat(macos): AudioEncoder dual-track + sidecar (Phase 1A) (210db62)
- feat: multi-channel transcript parser + words handler + AVPlayer-based AudioPlayerManager (ca519e7)

### 🐛 Bug Fixes

- fix(api): wordsHandler defends against missing words + malformed JSON (e9be690)
- fix(macos): Mitigation B silent fill uses input ASBD sample rate (f6b8fea)
- fix(macos): explicit role↔track switch in sidecar writer (d10cac7)
- fix(macos): flatten sidecar JSON to match docs/06 contract (cc54b14)
- fix(macos): AudioEncoder.finalize() throws on writer failure (1da2317)
- fix(macos): defer cleanup in stopRecording (e7c51e4)
- fix(macos): SCK outputs on dedicated serial queue + lint guard (8bc6de4)
- fix(api): add same-origin guard for cookie-authenticated writes (STU-645) (b1a5415)
- fix(api): verify Cloudflare Access JWT signature, issuer, and audience (87fabd9)
- fix(deps): upgrade ws to resolve CVEs (6f59eb9)
- fix(e2e): auto-build static assets when missing (worktree-friendly) (e854d47)

### 📝 Other Changes

- chore(deps): bump @nocoo/next-ai 0.3.0 -> 0.4.0 (4ed699f)
- chore(deps): bump @nocoo/next-ai 0.2.1 -> 0.3.0 (ai 6 -> 7) (5f0a7a1)
- docs: sync docs/06 implementation drift + docs/04 hook status (e1e5103)
- docs(macos): add audio pipeline phase retrospective (d216406)
- docs(macos): record task #7 6DQ deferral and task #8 not-triggered decision (d202f49)
- test(macos): live E2E conditional sidecar consistency check (39c7f28)
- test(macos): deterministic dual+legacy recording pipeline integration (2c608a2)
- docs(macos): collapse last "Mitigation prefix" reference (bfad750)
- docs(macos): collapse stale Mitigation A references to limitation pin (38c9db8)
- test(e2e): add dual-track ASR live-gate scaffold for Phase 0B (91b7ce2)
- test(macos): pin AVAssetWriter PTS normalisation, gap compression, and track-order behaviour (c2732df)
- chore(macos): allow hook tests without signing cert (ff40885)
- test(e2e): align api expectations with actual handler contracts (a5f3f25)
- docs(macos): align sidecar prose with did-append algorithm + content-based track-order probe (86472b6)
- docs(macos): rebase sidecar mapping on did-append + add() order, narrow fallback (13e856d)
- docs(macos): replace AVAssetWriterInput.metadata with tracks.json sidecar (4a8f422)
- docs(macos): clear recordingStartTime in stopRecording defer (220e8de)
- docs(macos): preserve stopRecording URL return + unify metadata identifier (507f60a)
- docs(macos): fix PCM settings, track metadata, stop defer, silent PCM wording (6a85e0b)
- docs(macos): refine audio pipeline plan — silent PCM, trackID, fallback (3b3575f)
- docs(macos): add audio pipeline redesign plan (AVAssetWriter dual-track) (8f06244)
- chore(security): pin trustedDependencies to better-sqlite3, husky (2e40ab7)
- chore(security): add quarterly ignoreUntil + grouping to osv-scanner suppressions (4cd5862)
- chore(deps): bump @babel/core, js-yaml, undici, vite, ws to OSV-clean versions (bd65393)
- chore(ci): pin base-ci reusable workflow to v2026.5 SHA (16bf1e1)
- test(e2e): send same-origin Origin from cookie-auth E2E clients (STU-645) (c20050b)
- test(api): isolate access-auth tests from the per-teamDomain JWKS cache (949cfb7)
- chore(deps): override esbuild to ^0.28.1 (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) (ee2a2fd)
- ci: upgrade base-ci to v2026.4 (daffd4b)
- chore(deps): bump hono 4.12.18 -> 4.12.25 and react-router 7.1.1 -> 7.17.0 (64868d1)
- chore(deps): bump apps/web vitest 3.2.4 -> 4.1.8 (GHSA-5xrq-8626-4rwp) (6e847de)
- ci(security): pass --ignore-scripts to bun install (Shai-Hulud defense) (3ea3a5b)
- chore(hooks): add L2 API E2E to pre-push gate (dbc9e01)
- test: align e2e suites after AI settings rename and add display-skip (4b1b9e2)


## v1.6.8 (2026-05-12)

### 🚀 Features

- feat(api): make ASR model configurable via user settings (3952361)
- feat(api): add ASR settings route and mount at /api/settings/asr (5eb3f98)
- feat(api): add ASR settings handler for model selection (4b85303)
- feat(web): default Settings section to expanded in sidebar (e45c203)

### 🐛 Bug Fixes

- fix(web): match ASR card height to AI card on settings page (05bb3e2)
- fix(api,web): restrict ASR models to filetrans-compatible, add validation (201cf71)
- fix(web): unify property save via Save button, fix duplicate icons (3267e7f)

### 📝 Other Changes

- test(api): add unit tests for settings-asr handler (5d6e10d)
- test(api): sync route-test helper with ASR settings route (a3bd38f)
- test(e2e): add route coverage for GET/PUT /api/settings/asr (5ec2c45)


## v1.6.7 (2026-05-12)

### 🐛 Bug Fixes

- fix(macos): recordings tab spinner stuck on first launch (7221d8b)
- fix(macos): align LiveResponse.timestamp type with server (String, not Int) (c9f81e3)

### 📝 Other Changes

- chore: add .claude/ to .gitignore (5a3423b)


## v1.6.6 (2026-05-12)

### 🚀 Features

- feat(macos): add CF Access service token for API requests (e56f7bc)
- feat(security): add unified gate scripts, update happy-dom (f5b7a78)
- feat(e2e): add L2 real Worker E2E tests with route coverage gate (c219bdc)
- feat(web): migrate apps/web tests from bun test to vitest (f43121b)
- feat(api): Wave E — deploy Worker to Cloudflare with D1 + custom domains (a6e424d)
- feat(web): Wave D step 2 — port pages, components, and view models from legacy (53aab4f)
- feat(web): Wave D step 1 — Vite SPA shell, data layer, auth gate (2066269)
- feat(api): Wave C.1 — scaffold Hono Worker (apps/api) (9d3247b)
- feat(api): Wave B.5 — add cronTickHandler for new worker (3ad5be6)

### 🐛 Bug Fixes

- fix(dev): unblock local dev server (allowedHosts + auth bypass + dev:all) (3cb3cb8)
- fix(deps): upgrade hono to fix CVEs (GHSA-69xw, GHSA-9vqf) (63236e0)
- fix(e2e): resolve strict mode violations and ESM compat in L3 specs (71078a0)
- fix(web): emit terminal job events for list-mode useJobEvents (8a2a51b)
- fix(web,api): wire missing SPA→Worker routes uncovered post-Wave D (66a6c73)
- fix(auth): register session provider deterministically in legacy adapter (6720667)

### 📝 Other Changes

- chore: add .dev.vars to .gitignore (3d79959)
- docs: update test references from bun test to vitest (b87c6f9)
- ci: add release.yml for CF Worker CD (b29ee54)
- ci: enable L2 API E2E and L3 Playwright browser E2E in CI (c007af7)
- docs: mark L3 BDD E2E acceptance criteria as completed (11bb944)
- test(e2e): add L3 BDD Playwright specs and page coverage gate (b7f12c4)
- build: add @playwright/test and L3 scripts (5ee0a77)
- chore(coverage): add per-package thresholds for API handlers (1db8724)
- test: cover runBatch driver branches (7e6e7d4)
- chore: replace per-package bun test scripts with root vitest (9335a00)
- test: migrate from bun:test to vitest (fa33b36)
- build: add vitest + v8 coverage with 95% gate (70a624d)
- style: unify HTML title to "lyre - Audio Transcription Manager" (dbfaf38)
- docs: mark L2 E2E and security gates as completed in quality plan (5a5a656)
- docs: fix quality upgrade plan (3 review items) (fb86d8d)
- docs: fix quality upgrade plan (5 review items) (45381ba)
- docs: fix quality upgrade plan (7 review items) (2a124b7)
- docs: add quality upgrade plan (L1-L3/G1-G2/CD vs dove) (d2a887b)
- chore: remove Next.js/NextAuth legacy references (05a510a)
- refactor(deploy): single worker `lyre` (remove -test env deployment) (0af5f6e)
- ci: drop L2 e2e step (apps/web_legacy removed) (376ab92)
- deps: upgrade next to 16.2.4 (852c8f7)
- docs: rewrite README/CLAUDE/docs for Cloudflare Worker + D1 + Vite SPA (ddc90f5)
- chore: simplify root scripts + husky hooks for the new workspace layout (a737dbe)
- refactor(api): drop legacy SQLite singletons + force explicit db/env injection (2c68d27)
- chore(api): tighten eslint-disable scope on lazy-require helpers (a2ce9de)
- chore(web): Wave D step 3 — eslint deps + import-restriction tightening (1ae5707)
- refactor(api): Wave C.0 — async-rewrite repo/handler/service layer for D1 (1b8e052)
- refactor(api): Wave C.0 step 1 — add rowsAffected driver-adapter helper (cbd01f5)
- test(api): Wave B.6.b.4 — D1 repo async-mismatch probe (876baf7)
- refactor(api): Wave B.6.b.3 — services accept optional db (d8bee25)
- refactor(api): Wave B.6.b.2 — handlers + auth use ctx.db (95427d6)
- refactor(api): Wave B.6.b.1 — repo factory functions (cf25336)
- refactor(api): Wave B.6.a — split DB drivers, expose ctx.db injection seam (f6eb9d2)
- chore(migration): Wave B.4 — dual-workspace lint/test/coverage gates (55fd4bb)
- chore(migration): Wave B.3 — extract handlers + RuntimeContext, drop Next deps from @lyre/api (0c78bbb)
- chore(migration): Wave B.2 — physically move db/services/lib to @lyre/api (bef9ec9)
- chore(migration): Wave B.1 — extract @lyre/api/contracts/* and enforce UI boundary (4846a01)
- chore(migration): Wave B.0 — D1 compatibility spike (gate cleared) (0d2c248)
- chore(migration): Wave A — archive legacy web, scaffold new workspaces (d38093b)
- docs: add CF Worker migration plan (docs/03) (40147c9)
- chore(security): ignore postcss GHSA-qx2v-qp2m-jg93 (build-time only) (1d3f219)
- ci: upgrade base-ci to v2026.1 (0ec7e21)
- ci(g2): add gitleaks to pre-commit and osv-scanner to pre-push (3b14c66)


## v1.6.5 (2026-04-18)

### 🚀 Features

- feat(deps): add @nocoo/next-ai, remove redundant AI SDK deps (7a6f2ff)
- feat(web): upgrade /api/live to surety standard (9c16297)
- feat(scripts): add automated release script (8a49f8a)
- feat(api): add component field to /api/live health check (c0eccac)
- feat(tokens): add rounded-card and rounded-widget utility classes (3a916c2)

### 🐛 Bug Fixes

- fix(scripts): add clean-tree check to release script (7de2607)
- fix(test): resolve TS errors in backy-service.test.ts (6354a48)
- fix(test): resolve TS errors in theme.test.ts (178c8ec)
- fix(test): resolve TS errors in proxy.test.ts (126e700)
- fix(test): resolve TS errors in oss-service.test.ts (7d0c6f7)
- fix(test): resolve TS errors in use-job-events.test.ts (75dd004)
- fix(test): resolve TS errors in jobs-repo.test.ts (5c83515)
- fix(test): resolve TS errors in job-processor.test.ts (3c8bd17)
- fix(test): resolve TS errors in job-manager.test.ts (9cf6ec4)
- fix(scripts): sync macOS version in release script (a3b0d72)
- fix(lint): remove unused eslint-disable directive in setup.ts (65f9d47)
- fix(deps): override hono to >=4.12.14 — fix GHSA-458j-xx4x-4375 (ffbf96e)
- fix(ui): skeleton use bg-secondary instead of bg-muted (f796e1d)
- fix(ui): add tabular-nums to duration displays in recording cards (f4cace6)
- fix(ui): remove shadow from non-overlay components (518750a)
- fix(components): replace border-input anti-pattern in app components (336c52d)
- fix(ui): replace anti-pattern tokens in base components (0cf8a95)
- fix(ci): 迁移到 base-ci@v2026，禁用 L2 E2E (4af4118)
- fix(deps): update next, path-to-regexp, picomatch (49219d7)
- fix(deps): update vulnerable deps + add osv-scanner.toml (511b54b)
- fix: resolve B-4 content page UI violations (93f5011)
- fix: dashboard group labels, chevron size, and breadcrumb aria per basalt B-2 spec (b09793a)
- fix: login page layout, github link, and aria-hidden per basalt spec (7eb62e1)
- fix: update stale doc paths in CHANGELOG.md (ab76ebd)
- fix: align logo assets with single-source pipeline convention (21f465f)

### 📝 Other Changes

- ci: enable typecheck in CI workflow (11dc40f)
- test(ai): update ai-service tests for next-ai migration (50799aa)
- refactor(ai): update consumers to use createAiModel from next-ai (80de230)
- refactor(ai): migrate services/ai.ts to use @nocoo/next-ai (79388c3)
- ci: enable L2 API E2E tests (ba5e003)
- chore(coverage): auto-discover test files and raise threshold to 95% (ffefc2f)
- test(proxy): add unit tests covering auth routing and redirect URL construction (0e6e40b)
- test: add bunfig.toml to scope coverage to unit-tested modules (5f50e48)
- chore(g1): add typecheck script (fad1697)
- chore: remove stale hono CVE ignores from osv-scanner.toml (51787e1)
- Revert "chore(security): ignore GHSA-458j-xx4x-4375 hono indirect via shadcn" (cc6a1ee)
- chore(security): ignore GHSA-458j-xx4x-4375 hono indirect via shadcn (4c8e119)
- chore(quality): 6DQ G1 — add --max-warnings=0 to lint (#1) (41ee14f)
- ci: migrate to nocoo/base-ci@v2026 (f0248d5)
- ci: fix .gitleaks.toml format — use flat regex list (e82ff23)
- ci: add .gitleaks.toml to allowlist test mock keys (6ad9373)
- ci: add GitHub Actions CI workflow (ccfabda)
- chore: migrate dev port 7025 → 7016 (23a549e)
- chore: bump version to 1.6.3 (dfe4487)
- refactor: move logo assets to project root per basalt B-3 spec (8226a99)
- chore: bump version to 1.6.2 (c0d0b2a)
- docs: add docs index link to README (d284cde)
- docs: add docs/README.md index (2a8b87a)
- docs: renumber active docs (03→01, 04→02) (0c55332)
- chore: archive stale planning docs (3e86c17)
- docs: clarify apple development signing (2e17a3a)


All notable changes to this project will be documented in this file.

## [v1.6.0] - 2026-03-06

### Changed

- Upgrade React and React DOM from 19.2.3 to 19.2.4 (DoS mitigations for Server Actions/Components)
- Upgrade AI SDK: `ai` 6.0.97→6.0.116, `@ai-sdk/anthropic` 3.0.46→3.0.58, `@ai-sdk/openai` 3.0.30→3.0.41
- Upgrade Tailwind CSS and PostCSS plugin from 4.2.0 to 4.2.1
- Upgrade lucide-react from ^0.575.0 to ^0.577.0
- Upgrade ESLint 9.39.2→9.39.3, @types/bun 1.3.9→1.3.10, @types/node 20.19.33→20.19.37

### Improved

- Extract theme pure functions to `theme-utils.ts` for better testability
- Extract sidebar nav utilities and rewrite tests to use real imports
- Deduplicate `hashString`, keep single source in `utils.ts`
- Export matcher pattern from `proxy.ts` so tests import real source
- Consolidate unit tests with `test.each` for better maintainability

### Fixed

- Keep `config.matcher` as static literal for Next.js build compatibility

### Docs

- Update CLAUDE.md: web tech stack, project structure, macOS structure with test counts
- Update README with monorepo structure, AI/charts stack, and new features
- Add missing v1.5.3 changelog entry

## [v1.5.5] - 2026-03-02

### Added

- Bidirectional Backy integration: Pull direction (Backy → Lyre webhook → auto-push backup)
- `POST /api/backy/pull` webhook endpoint for Backy-triggered automatic backups (authenticated via `X-Webhook-Key` header)
- `HEAD /api/backy/pull` health check endpoint for verifying pull key validity
- Pull Key CRUD: `POST/DELETE /api/settings/backy/pull-key` for generating and revoking pull keys
- `findByKeyAndValue()` method on `settingsRepo` for reverse-lookup (pull key → userId)
- Pull Webhook Settings UI card: generate/regenerate/revoke key, copy webhook URL/key, curl example
- E2E tests for pull key CRUD and pull webhook endpoints (12 new tests)
- Unit tests for pull key service functions and `findByKeyAndValue` (18 new tests)
- Pull webhook documentation in `docs/02-backy.md` with full API reference and architecture diagrams

### Changed

- `GET /api/settings/backy` response now includes `hasPullKey` and `pullKey` fields
- Backy docs updated to reflect bidirectional architecture (Push + Pull)

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

## [v1.5.3] - 2026-02-28

### Changed

- Migrated tag system from legacy JSON column (`recordings.tags`) to normalized `recording_tags` join table across all layers (API, repository, UI)
- Native macOS app rewritten from Tauri/Rust to pure Swift/SwiftUI (`MenuBarExtra` menu bar app)
- Audio encoding extracted into dedicated `AudioEncoder` class (AVAssetWriter M4A/AAC)
- Auth token storage migrated from plaintext JSON to macOS Keychain
- Upload uses streaming file transfer instead of loading entire recording into memory

### Added

- macOS app: file system watcher for auto-refreshing recordings list
- macOS app: multi-select batch delete in recordings view
- macOS app: input device memory persisted across app restarts
- macOS app: metadata fetch error surfacing in upload sheet UI
- macOS app: CoreAudio listener for auto-refreshing device list on hardware changes

### Fixed

- Tag associations now written to `recording_tags` join table on recording creation
- `@MainActor` added to `UploadManager` for safe UI state updates
- Audio mixer max buffer size cap to prevent unbounded memory growth
- Encoder finalization on stream error to prevent file corruption
- GLM model updated from `glm-4.5` to `glm-4.7`

## [v1.5.2] - 2026-02-23

### Added

- Remote backup history panel in Settings: displays total backup count and recent entries from Backy
- `GET /api/settings/backy/history` endpoint proxies to Backy webhook for backup history retrieval
- `fetchBackyHistory()` service function with full error handling (HTTP errors, network failures)
- Auto-refresh: history loads on page mount when configured, and refreshes after successful push
- Manual refresh button for remote backup history
- Backy integration docs (`docs/02-backy.md`): webhook API reference, architecture, and integration guide

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
