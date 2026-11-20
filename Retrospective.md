# Retrospective

## 2026-11-21: Release script review round — bind every wait to the exact evidence

The first version of the rewritten `scripts/release.ts` waited for _a_
successful CI run and _a_ successful deployment of the release commit, without
keeping the CI run ID or proving that the deployment was the one triggered by
that CI run. It also created the tag on whatever HEAD was when the waiting
ended. Three general rules came out of the review: record the identifier of
the evidence you waited for and re-check it in the next step (the deploy log
prints `Resolved release source <sha> run <ci-run-id>`, which binds the
deployment to both); pass the commit SHA explicitly to `git tag` instead of
relying on the moving HEAD; and assume branch protection — a direct push of a
fresh commit to a ruleset-protected `main` is rejected, so the script must
offer the pull-request path and resume from the merged commit without
re-bumping the version or duplicating the CHANGELOG entry. Strict
`tsc --noEmit` on the script also caught a parameter named `run` shadowing the
shell helper: typecheck the release tooling itself, not only the app.

## 2026-11-20: A tag push raced the CI run it was supposed to prove

The `v2.1.9` tag was pushed three seconds after the release commit landed on
`main`, while that commit's `CI` run was still executing. The Release workflow
had both a `push` tag trigger and a `workflow_run` trigger, so the tag run
failed the fail-closed `release-source` proof ("No successful
`.github/workflows/ci.yml` run on main for `4aaf530`") while the `workflow_run`
deploy of the same commit succeeded minutes later. The tag trigger could only
ever lose that race or deploy the same commit a second time; it was removed.
The retry of the failed run also failed because the pinned base-ci release
filtered the run list with `status=completed`; base-ci v2026.16 dropped that
filter and this repository is now pinned to it.

`scripts/release.ts` had the same defect in a milder form: it pushed the commit
and the tag back to back. It now pushes the commit to `origin main`, waits for
the successful `CI` run of that commit and for the matching `Release`
deployment, and only then creates the annotated tag, pushes it, and creates the
GitHub Release. Any non-green step aborts the release before a tag exists.

Two general rules: a deploy trigger must carry evidence that is already green
instead of a ref that merely points at a commit, and a tag must be the last
step of a release, never the trigger of one.

## 2026-11-20: `Path.is_file()` crashes on protected dangling symlinks

The `gate:l1-selftest` self-test crashed with `PermissionError:
/usr/sbin/weakpass_edit` while it built its isolated PATH. `pathlib.Path.is_file()`
propagates `EACCES`, while `os.path.isfile()` reports it as "not a file"; the
helper now uses `os.path.isfile()` so an unreadable PATH entry is skipped
instead of aborting the whole gate.

## 2026-11-14: Isolate executable names, not installation-directory names

The missing-native-tool self-test assumed a SwiftLint directory would contain
`swiftlint` in its name. Homebrew installs the command in `/opt/homebrew/bin`, so
the probe left it available and rejected a healthy hook result. Build an owned
PATH from real executable links, pass the healthy production hook first, then
remove only the owned link for each native tool. Verify failed executable lookup
and its exact missing-tool diagnostic; an arbitrary nonzero exit is not proof.
Keep real tools untouched and retain every other negative probe.

## 2026-11-14: Locate the background trigger while a modal is open

The new sidebar geometry suite initially used a default role locator to read the
menu button's `aria-expanded` after opening SidebarDrawer. Radix correctly hides
the background from the accessibility tree, so all six mobile cases stopped at
the locator rather than measuring the drawer. Use `includeHidden: true` only for
that known background trigger; keep drawer controls scoped to the visible modal.
The complete rerun passed all 29 cases, with every geometry and behavior assertion
retained. Do not treat this locator correction as a component geometry fix.

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

- **SCStream requires registering each output type separately**: Apple's `SCStream.addStreamOutput(_:type:)` must be called for **each** `SCStreamOutputType` you want to receive. Setting `capturesMicrophone = true` in `SCStreamConfiguration` enables microphone capture at the system level, but the stream only delivers microphone buffers if you also register an output handler with type `.microphone`. Without this registration, mic samples are silently discarded — the handler registered for `.audio` never sees them.
- **System audio + microphone are separate PCM streams that must be mixed**: ScreenCaptureKit delivers system audio and microphone as independent `CMSampleBuffer` streams. Simply concatenating both into the same encoder doubles the recording duration. The correct approach is an `AudioMixer` that buffers both sources independently and outputs their sample-by-sample average `(a + b) / 2`. The mixer also handles the single-source fallback (e.g. no mic permission) by draining the active buffer after a threshold (~100ms at 48kHz) to prevent unbounded accumulation.
- **D1 schema must be migrated explicitly after a schema change**: `wrangler d1 migrations apply` does not run automatically on `wrangler deploy`. After any Drizzle schema change, generate the SQL and apply it to the D1 database before deploying the Worker that depends on the new columns.
- **No global DB singleton**: Every repo is constructed via `makeRepos(db)` inside a handler with the request-scoped D1 handle. Adding a new singleton anywhere breaks D1 (no shared connection across requests) and breaks tests (no isolation between cases).
- **`@MainActor` static constants read from `@Sendable` closures need `nonisolated`**: `NSWorkspace.notificationCenter.addObserver(forName:...)` calls its closure with `@Sendable` semantics. If that closure reads a `static let` on a `@MainActor` class, Swift 6 strict concurrency emits a "main actor-isolated static property can not be referenced from a Sendable closure" warning. The immutable value is trivially safe to read from any actor, so annotating the constant `nonisolated static let teamsBundleIDs: Set<String> = [...]` clears the warning without wrapping the callback in `Task { @MainActor in ... }` just to read a constant. (`Meeting/TeamsMeetingWatcher.swift`.)
- **`NSAlert.runModal()` + `AsyncStream` gate the reentrance yourself**: When a coordinator consumes an `AsyncStream<Bool>` and calls `NSAlert.runModal()` inline, the consumer's `for await` blocks on the modal. Any event that arrives during the modal sits in `.bufferingNewest(1)` and is delivered right after the modal returns — by then the "prompt is up" flag has already been cleared, and the stale event slips through as a follow-up prompt (DQ-8 in `docs/07-teams-meeting-detector.md`). Fix: keep the stream consumer non-blocking (`dispatch(active:)` is sync, flips the gate, launches a `Task` for the modal); at the end of the modal task `await Task.yield()` **before** clearing the gate so a fast-returning path (a synchronous fake or a real recorder call that has no real suspension points) does not race the buffered event past the gate. Also, drop-by-gate must still update the "last observed" state, otherwise the next real `false → true` transition looks like the same meeting and the prompt gets wrongly suppressed forever. (`Meeting/MeetingPromptCoordinator.swift`.)
- **`osascript` UI scripting needs Accessibility permission**: `System Events` returns `error -1719: not allowed assistive access` when driving a SwiftUI Toggle from a headless CLI session. Toggle-driven DQ scenarios that can only be exercised through the real Settings pane are unblockable without an interactive Xcode Run or granting the terminal Accessibility in System Settings. Fall back to `defaults write <bundle-id> <key> -bool ...` + relaunch to prove the init-path branch, and record the runtime `.onChange` verification as an open item with the exact `log stream --predicate 'subsystem == "ai.hexly.lyre"'` incantation the reviewer can run manually.

## 2026-09-26: Canonical paths in native filesystem fixtures

New recording-store tests initially compared temporary URLs under `/var` with
files enumerated under `/private/var`. These aliases refer to the same files,
but Foundation URL equality treats them as different identities, causing false
URL assertions and exercising a different refresh path than intended. On Darwin,
`resolvingSymlinksInPath()` can still return the `/var` spelling. Use enumerated
URLs for identity-based refresh tests and compare `standardizedFileURL` when
asserting filesystem equivalence. Keep watcher assertions bounded and wait for
scans to finish before reading results.

## 2026-09-26: Serialize CI validation for the same ref

During CI/CD verification, a manual CI run cancelled the in-progress push CI.
The caller workflow did not declare concurrency, but its pinned reusable quality
workflow grouped runs by `github.workflow` and `github.ref` with
`cancel-in-progress: true`. Inspect concurrency in called workflows before
scheduling validation. Finish push CI and its dependent release before starting
manual CI on the same ref; a cancelled aggregate is not passing CI evidence.

## 2026-09-29: Separate browser and native test output

Running Playwright alongside native verification deleted the native DerivedData
and result bundle during compilation. Playwright cleans its output directory at
startup; its default `test-results` directory also contained the native runner's
`test-results/macos`. Set Playwright output to `test-results/bdd` and keep native
verification serialized or independently isolated. The interrupted native run
was not passing evidence; a complete rerun under a unique `/tmp` directory passed.

## 2026-10-23: Mock detached storage cleanup in unit tests

Vitest 5 exposed a teardown race after all assertions passed: two recording
deletion tests supplied fake OSS credentials but left the real fetch active.
Detached cleanup requests could fail after their test finished, leaving a
console RPC pending during worker shutdown. Stub both object deletion and result
listing at the network boundary, and assert the cleanup requests and database
deletion. Fake credentials are not network isolation. Do not suppress teardown
errors or retry a flaky gate without investigating the outstanding work.

## 2026-10-23: Restart the dev optimizer after UI dependency upgrades

The local acceptance server kept serving optimized Basalt 2.2.0 modules after
the manifest and installed package moved to 3.2.1. Builds and browser tests
against the built Worker passed, but did not verify the long-running Vite
server. Its old sidebar used accent backgrounds instead of the new neutral
selection and independent hover layer. Restart Vite with `--force` after a
dependency migration and check optimizer source paths before handing off the
local URL. Keep theme accents in `AccentProvider`, not competing CSS overrides.

## 2026-10-23: Pass the Xcode toolchain to push hooks

The first v2.1.5 push failed because standalone SwiftLint inherited Command Line
Tools and could not load SourceKit. Commit checks and native tests passed because
their runners already supplied the full Xcode path. Check `xcode-select -p` before
pushing and set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` on the
push command when needed. Re-run the normal hooks; do not change global toolchain
selection or bypass the failed check.
