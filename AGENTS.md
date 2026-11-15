# Lyre

Audio recording, transcription and word-level playback across a web app and native macOS recorder.
Profile: ts-worker-web + native-tool (Swift).
Direction: [README.md](README.md). Frameworks must preserve this handbook.

## Sources of Truth

This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.

| Fact                 | Where                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| Setup / architecture | [development](docs/08-development.md), [agent details](docs/12-agent-operations.md) |
| Version              | root `package.json`; workspaces and `apps/macos/project.yml` stay aligned           |
| API / test scope     | `packages/api`, `vitest.config.ts`, `scripts/run-e2e.ts`                            |
| Native / gates       | `scripts/test-macos.ts`, `.husky`, `scripts/pre-push.ts`, CI                        |
| Accidents            | [Retrospective.md](Retrospective.md)                                                |
| Machine workflow     | global `AGENTS.md` and Git rules                                                    |

## Project Invariants

- One Worker serves `/api/*` and the built Vite SPA. Keep `packages/api` framework-agnostic with request-scoped `RuntimeContext` and `makeRepos(db)`; no global DB/env singleton.
- Verify Access JWT signature/issuer/audience and fail closed; bearer device tokens are a separate native path. Test auth bypass must remain unavailable in production.
- Missing `DASHSCOPE_API_KEY` selects mock ASR. Cron polls jobs; the SPA polls `/api/jobs`. Real recordings, OSS, ASR and AI providers require explicit live-test scope.
- Register mic and system streams separately, mix aligned samples before encoding, and retain single-source fallback/backpressure. Never concatenate streams into doubled recordings.
- Preserve native permissions and signing identity. Only explicit live recording tests may request capture; default native tests disable live audio. Keep lucide-react as the only web icon library.

## Stack / Layout

| Component    | Path / choice                                                     |
| ------------ | ----------------------------------------------------------------- |
| Web / Worker | `apps/web` Vite/React; `apps/api` Hono/D1/ASSETS                  |
| Core API     | `packages/api`; Drizzle, Aliyun OSS/DashScope, AI SDK             |
| Native       | `apps/macos`; Swift 6, SwiftUI/AppKit, ScreenCaptureKit, xcodegen |

## Commands

Run from root with Bun, Node 22.22+ (22.x), 24.x or 26+, macOS 15+, full Xcode, Python 3, xcodegen, SwiftLint, gitleaks and OSV. Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` per command if Command Line Tools is selected. Use tracked env examples; local tests need no live provider secrets.

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run build
bun run test:coverage
bun run gate:l1-selftest         # L1 hook negative probes + web-lane timing (auto cleanup)
bun run test:macos               # isolated, live audio disabled
bun run test:e2e                 # local Worker API tests
bun run test:e2e:bdd             # local browser tests
bun run gate:routes
bun run gate:pages
```

## Verification

Quality follows System1 v1.3.0 Native Mode (`nocoo/base-ci v2026.15`) in `.github/workflows/quality-slots.yml` and `.github/workflows/ci.yml`. Status: `enforced`, `planned`, `manual`, or `N/A`.

| Slot              | Status   | Evidence                                                                           |
| ----------------- | -------- | ---------------------------------------------------------------------------------- |
| `S1` Types        | enforced | `bun run typecheck` (pre-commit + CI)                                              |
| `S2` Lint         | enforced | `bun run lint` (Biome + SwiftLint in pre-commit; Biome in CI)                      |
| `S3` Workflow     | enforced | SHA-pinned workflow action check in CI                                             |
| `G1` Secrets      | enforced | `gitleaks` (`.gitleaks.toml`) in pre-commit + CI                                   |
| `G2` Dependencies | enforced | `osv-scanner` (`bun.lock`) in pre-push + CI                                        |
| `B1` Build        | enforced | `bun run build` in CI                                                              |
| `L1` Unit         | enforced | `bun run test:coverage` + `bun run gate:l1-selftest` in CI                         |
| `L2` Runtime      | N/A      | Runtime verified via `wrangler dev` in `L3`/`L4`                                   |
| `L3` Integration  | enforced | `bun run test:e2e` in CI + pre-push                                                |
| `L4` E2E          | enforced | `bun run test:e2e:bdd` (Playwright Chromium) in CI                                 |
| `P1` Package      | N/A      | Private monorepo, not published to npm                                             |
| `Z1` Gate         | enforced | `quality / Z1: Gate` required status check on `main` (includes `l1-hook-selftest`) |

Pre-commit executes the staged `scripts/pre-commit.py`, exports the index, links installed JS packages read-only with snapshot-local workspace links and caches, and runs check-only secrets, lint, types, coverage and native tests. Pre-push builds the SPA, then runs dependency scan, lint/types, coverage, local API E2E, native tests and SwiftLint in parallel.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources / Isolation

API E2E uses loopback 7017; BDD uses 27016. `--env test` here names local bindings, not a provisioned remote environment; schema commands use `--local`. Current runners lack `--persist-to` and may share default state, so serialize them. Require future per-run local SQLite/storage, `NODE_ENV=test`, checked markers and guarded cleanup. Native run artifacts live under `test-results/macos/run-*`.

## Operations / Release

Apply D1 migrations before an authorized Worker deployment. [Release details](docs/12-agent-operations.md) cover synchronized versions, xcodegen, changelog and DMG packaging. Releases use Developer ID; `LYRE_ALLOW_ADHOC=1` is explicit and cannot promise stable TCC or notarization. Test ad-hoc flags are not release signing.

Every macOS release must attach its versioned DMG and `SHA256SUMS` to the matching GitHub Release. Build from the exact release commit in an isolated directory, verify the mounted app's version, signature integrity and architectures, and state the actual signing/notarization status. Include copyable, Lyre-scoped quarantine and signature recovery commands directly in the Release page, plus the permission reauthorization note; do not require users to find them in repository docs. Publish matching Web/Worker changes and verify exact-revision CI and the deployed `/api/live` version.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Swift 6 Sendable closures may need immutable `nonisolated` constants; do not suppress actor-safety warnings.
- Keep modal prompt stream consumers non-blocking and gate buffered reentry.
- Record accessibility/permission blockers as unverified manual scenarios, never as passed UI checks.
