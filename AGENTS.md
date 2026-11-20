# Lyre

Audio recording, transcription, and word-level playback across a Vite/React/`@nocoo/basalt` SPA (`apps/web`), Cloudflare Worker (`apps/api`, Hono/D1/ASSETS), shared API library (`packages/api`, Drizzle/OSS/DashScope/AI SDK), and native macOS Swift 6 menu-bar recorder (`apps/macos`, SwiftUI/AppKit/ScreenCaptureKit/xcodegen).
Docs: [README.md](README.md) · [Development](docs/08-development.md) · [Architecture & Release](docs/12-agent-operations.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Bun, Node 22.22+ (22.x), 24.x, or 26+, macOS 15+, full Xcode, Python 3, xcodegen, SwiftLint, `gitleaks`, and `osv-scanner`. Prefix commands with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` if `xcode-select` points to Command Line Tools. Env var names live in [docs/08-development.md](docs/08-development.md) and `apps/api/wrangler.toml`; local tests need no live provider secrets.

```sh
bun install --frozen-lockfile
bun run worker:dev               # 127.0.0.1:7017 (wrangler dev --env test)
bun run web:dev                  # https://lyre.dev.hexly.ai -> 127.0.0.1:7016
bun run typecheck                # S1 (web + worker + api)
bun run lint                     # S2 Biome check-only, 0 warnings
bun run build                    # B1 builds SPA into apps/api/static
bun run test:coverage            # L1 >= 95% on scoped modules (vitest.config.ts)
bun run gate:l1-selftest         # L1 hook negative probes + web-lane timing (auto cleanup)
bun run test:macos               # isolated native tests, live audio disabled
bun run test:e2e                 # L3 local Worker API tests (:7017)
bun run test:e2e:bdd             # L4 Playwright Chromium browser tests (:27016)
bun run gate:routes              # verify API route test coverage
bun run gate:pages               # verify web page test coverage
```

## Invariants

- **Single Worker & DI**: One Worker serves `/api/*` and built Vite SPA (`ASSETS`). Keep `packages/api` framework-agnostic with request-scoped `RuntimeContext` and `makeRepos(db)`; no global DB/env singleton.
- **Fail-closed auth**: Verify Cloudflare Access JWT signature, issuer, and audience and fail closed; native macOS uses bearer device tokens separately. `E2E_SKIP_AUTH=true` must remain unavailable in production.
- **Version alignment**: Root `package.json` is the single version source of truth; keep workspace `package.json` files and `apps/macos/project.yml` (`MARKETING_VERSION`) aligned.
- **ASR, cron & live scope**: Missing `DASHSCOPE_API_KEY` selects mock ASR. Cron polls jobs; the SPA polls `/api/jobs`. Real recordings, OSS, ASR, and AI providers require explicit live-test scope.
- **macOS dual-stream audio**: Register mic and system streams separately, mix aligned samples before encoding, and keep single-source fallback/backpressure. Never concatenate streams into doubled recordings.
- **Native permissions & UI**: Preserve native permissions and signing identity; default native tests disable live audio and only explicit live tests may capture. Keep `lucide-react` as the sole web icon library.
- **Swift 6 & modal streams**: Use immutable `nonisolated` constants in `@Sendable` closures; never suppress actor-safety warnings. Keep modal prompt stream consumers non-blocking and gate buffered reentry.
- **Verification discipline**: Record accessibility/permission blockers as unverified manual scenarios, never passed UI checks. Historical runs are not current evidence; never bypass hooks or use autofix in checks.
- **Release & deploy**: Deploys require explicit authorization; doc edits never authorize deploys or new gates. Apply D1 migrations before dependent Worker deploys; verify exact-revision CI and `/api/live`.
- **CD trigger set**: Production CD runs from `workflow_run` on a successful `main` CI run (or a manual dispatch naming a proven run/tag); tag pushes never trigger a deploy. Push the release commit first, wait for green CI and the matching deployment, and only then create and push the tag ([runbook](docs/12-agent-operations.md)).
- **macOS signing**: Sign releases with Developer ID; `LYRE_ALLOW_ADHOC=1` is explicit and cannot promise stable TCC or notarization. Test ad-hoc flags are not release signing.
- **GitHub Release DMG**: Build exact-commit DMG + `SHA256SUMS` in an isolated dir, verify mounted version/signature/archs, and attach both to GitHub Release ([runbook](docs/12-agent-operations.md)).
- **Release notes**: State actual signing/notarization status and put copyable Lyre-scoped quarantine/signature recovery commands and permission reauthorization notes directly in the Release page, not only in docs.

## Quality & Local Gates

Follows `system1-quality`; CI slot definitions and pinned `nocoo/base-ci` revision live in `.github/workflows/quality-slots.yml` (called by `.github/workflows/ci.yml`; `quality / Z1: Gate` required on `main`, including `l1-hook-selftest`). Close gaps without lowering the contract. Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` is `N/A` (verified via `wrangler dev` in `L3`/`L4`); `P1 Package` is `N/A` (private repo). Linux CI runs Biome-only for `S2`; SwiftLint and `test:macos` run locally.
- **Coverage scope**: `L1` enforces 95% on scoped JS in `vitest.config.ts` (wiring, repos, 5 handlers in `L3`/`L4`); native pre-commit enforces 33% line / 39% function interim floors (target 95%).
- **Pre-commit**: Installed via `bun run prepare` (`.husky/`). Runs staged `scripts/pre-commit.py` on an exported index snapshot (read-only deps, snapshot-local links/caches): `G1`, `S2`, `S1`, `L1`, and native tests.
- **Pre-push**: `.husky/pre-push` (`scripts/pre-push.ts`) builds the SPA (`web:build`), then runs `G2` (`osv-scanner`), `S2` (Biome + SwiftLint), `S1`, `L1`, `L3` (`test:e2e`), and `test:macos` in parallel.

## Resources & Isolation

| Lane      | Endpoint / State                                               | Boundary                                                             |
| --------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Dev       | `lyre.dev.hexly.ai` -> `127.0.0.1:7016`, Worker `:7017`        | Local `lyre-db-test`; never bring live `.dev.vars` into test copies  |
| API / BDD | `127.0.0.1:7017` (`L3`), `:27016` + `test-results/bdd/` (`L4`) | `--env test` is local-only; schema uses `--local`; serialize runs    |
| Native    | `test-results/macos/run-*`                                     | Live audio disabled by default; separate from `test-results/bdd/`    |
| Prod      | `https://lyre.hexly.ai`, D1 `lyre-db`, OSS `lyre`              | Read-only unless authorized; `[env.test]` shares `OSS_BUCKET="lyre"` |

- **Runner state**: API/BDD runners lack `--persist-to` and share `apps/api/.wrangler/state`, so serialize them. Future runners must add per-run SQLite/storage, `NODE_ENV=test`, checked markers, and guarded cleanup.

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
