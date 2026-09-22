# Lyre

Audio recording, transcription and word-level playback across a web app and native macOS recorder.
Profile: ts-worker-web + native-tool (Swift).
Direction: [README.md](README.md). Frameworks must preserve this handbook.

## Sources of Truth

This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.

| Fact | Where |
|---|---|
| Setup / architecture | [development](docs/08-development.md), [agent details](docs/12-agent-operations.md) |
| Version | root `package.json`; workspaces and `apps/macos/project.yml` stay aligned |
| API / test scope | `packages/api`, `vitest.config.ts`, `scripts/run-e2e.ts` |
| Native / gates | `scripts/test-macos.ts`, `.husky`, `scripts/pre-push.ts`, CI |
| Accidents | [Retrospective.md](Retrospective.md) |
| Machine workflow | global `AGENTS.md` and Git rules |

## Project Invariants

- One Worker serves `/api/*` and the built Vite SPA. Keep `packages/api` framework-agnostic with request-scoped `RuntimeContext` and `makeRepos(db)`; no global DB/env singleton.
- Verify Access JWT signature/issuer/audience and fail closed; bearer device tokens are a separate native path. Test auth bypass must remain unavailable in production.
- Missing `DASHSCOPE_API_KEY` selects mock ASR. Cron polls jobs; the SPA polls `/api/jobs`. Real recordings, OSS, ASR and AI providers require explicit live-test scope.
- Register mic and system streams separately, mix aligned samples before encoding, and retain single-source fallback/backpressure. Never concatenate streams into doubled recordings.
- Preserve native permissions and signing identity. Only explicit live recording tests may request capture; default native tests disable live audio. Keep lucide-react as the only web icon library.

## Stack / Layout

| Component | Path / choice |
|---|---|
| Web / Worker | `apps/web` Vite/React; `apps/api` Hono/D1/ASSETS |
| Core API | `packages/api`; Drizzle, Aliyun OSS/DashScope, AI SDK |
| Native | `apps/macos`; Swift 6, SwiftUI/AppKit, ScreenCaptureKit, xcodegen |

## Commands

Run from root with Bun, Node 22.12+, macOS 15+, full Xcode, Python 3, xcodegen, SwiftLint, gitleaks and OSV. Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` per command if Command Line Tools is selected. Use tracked env examples; local tests need no live provider secrets.

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run build
bun run test:coverage
bun run test:macos               # isolated, live audio disabled
bun run test:e2e                 # local Worker API tests
bun run test:e2e:bdd             # local browser tests
bun run gate:routes
bun run gate:pages
```

## Verification

6DQ retains its name. Former G1 is merged into L1; L2/L3, G2 and D1 retain their scope. Status: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; preserve any stricter package threshold. Native tools must identify unmeasured metrics as gaps.
L1 static analysis requires check-only strict analysis/formatting with zero errors/warnings. G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Index-snapshot gate enables all four 95% thresholds and existing group gates. Configured exclusions are by design and do not reduce the grade. |
| L1 Swift | planned | Index-snapshot Swift Testing compiles with warnings as errors. Xccov measures all application files; interim regression floors are lines 33% and functions 39%, below the unchanged 95% target. Swift statements/branches are unsupported and remain a certification gap. Three live-recording tests are explicitly outside the default offline run. |
| L2 API / native | planned | Local real-HTTP API tests run before push; require 100% routes including errors/auth. Native tests use test hosts; live capture/OS integration needs a separate fixture lane. |
| L3 web / desktop | planned | CI runs Playwright BDD and page/route audit scripts exist; all-page and native interaction proof is incomplete. Permissions/UI-only cases remain manual with exact evidence. |
| L1 static TS / Swift | enforced | Hooks run Biome with errors on warnings, typecheck and strict SwiftLint; native compilation uses the full Xcode toolchain. |
| G2 | enforced | Secret/dependency gates fail when gitleaks or OSV is absent; CI also scans. |
| D1 | planned | Unit DBs are per suite and native runs get unique DerivedData; Worker API/BDD use default local state rather than unique persist directories with marker/cleanup guards. |

Pre-commit executes the staged `scripts/pre-commit.py`, exports the index, links installed JS packages read-only with snapshot-local workspace links and caches, and runs check-only secrets, lint, types, coverage and native tests. Required tools/reports, empty or skipped required tests, failed checks, signals and an eight-minute bound reject. All outputs are temporary; secrets inspect the real index. Pre-push builds the SPA, then runs dependency scan, lint/types, coverage, local API E2E, native tests and SwiftLint in parallel.

Target hooks: pre-commit checks L1 against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources / Isolation

API E2E uses loopback 7017; BDD uses 27016. `--env test` here names local bindings, not a provisioned remote environment; schema commands use `--local`. Current runners lack `--persist-to` and may share default state, so serialize them. Require future per-run local SQLite/storage, `NODE_ENV=test`, checked markers and guarded cleanup. Native run artifacts live under `test-results/macos/run-*`.

## Operations / Release

Apply D1 migrations before an authorized Worker deployment. [Release details](docs/12-agent-operations.md) cover synchronized versions, xcodegen, changelog and DMG packaging. Releases use Developer ID; `LYRE_ALLOW_ADHOC=1` is explicit and cannot promise stable TCC or notarization. Test ad-hoc flags are not release signing.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Swift 6 Sendable closures may need immutable `nonisolated` constants; do not suppress actor-safety warnings.
- Keep modal prompt stream consumers non-blocking and gate buffered reentry.
- Record accessibility/permission blockers as unverified manual scenarios, never as passed UI checks.
