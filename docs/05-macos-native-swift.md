# macOS Native Swift Rewrite

Migrate the Lyre macOS menu bar app from Tauri/Rust to native Swift/SwiftUI.

## Motivation

The existing Tauri app wraps a Rust backend + Next.js static frontend. A native
Swift rewrite eliminates the Tauri runtime overhead, provides first-class macOS
integration, and simplifies the build/distribution pipeline.

## Core Use Case

**Meeting recording**: The app lives in the menu bar. One click starts recording
both the microphone (your voice) and system audio (other participants' voices
via speaker output). The recording is saved locally as M4A/AAC.

## Technical Decisions

| Decision            | Choice                                 |
|---------------------|----------------------------------------|
| UI framework        | SwiftUI (`MenuBarExtra`) + AppKit glue |
| Minimum macOS       | 15.0 (full ScreenCaptureKit support)   |
| Audio encoding      | AVFoundation (AAC/M4A, zero deps)      |
| Build system        | Xcode project (`xcodebuild` CLI)       |
| Networking          | URLSession (async/await)               |
| Project location    | Replace `apps/macos/`                  |
| Migration strategy  | Core-first, incremental phases         |

## Architecture

### Audio Pipeline

```
SCStream (macOS 15+)
  .audio  ── system audio (other participants)
  .microphone ── mic input  (your voice)
       │                │
       ▼                ▼
     AudioMixer
  weighted mixing: sys*0.8 + mic*2.5
        tanhf() soft clipping [-1.0, 1.0]
        single-source drain @ ~200ms threshold (9600 samples)
        NaN/Inf sanitization
        stereo→mono: louder channel (not average)
       │
       ▼
     AVAssetWriter (M4A/AAC)
       48 kHz, mono, 192 kbps
       real-time encoding
       │
       ▼
     ~/Music/Lyre Recordings/recording-YYYYMMDD-HHMMSS.m4a
```

### Permission Model

Two permissions are required. Both Dev and Release builds must present the same
permission flow to ensure consistent behavior.

| Permission                     | Trigger                           | User Action                      |
|-------------------------------|-----------------------------------|----------------------------------|
| Screen & System Audio Recording | `SCShareableContent.current`     | System alert → System Settings   |
| Microphone                     | `SCStream` + `captureMicrophone` | System alert → Allow / Deny      |

**Permission guide**: On first launch (or when permissions are missing), the app
shows a step-by-step guide window explaining each permission, its purpose, and
a button to open System Settings. A polling timer detects when permissions are
granted and auto-advances.

### Project Structure

```
apps/macos/
├── project.yml                    ← xcodegen project definition
├── .swiftlint.yml                 ← SwiftLint config
├── Lyre.xcodeproj/                ← Generated (xcodegen generate)
├── Lyre/
│   ├── LyreApp.swift              ← @main, MenuBarExtra, TrayMenu, MainWindowView
│   ├── Constants.swift            ← Shared constants (subsystem, audio params)
│   ├── Info.plist                  ← LSUIElement, NSMicrophoneUsageDescription
│   ├── Lyre.entitlements           ← Audio Input
│   ├── Assets.xcassets/            ← App icon, tray icons
│   ├── Audio/
│   │   ├── PermissionManager.swift
│   │   ├── AudioCaptureManager.swift
│   │   ├── AudioMixer.swift
│   │   └── RecordingManager.swift  ← State machine + AVAssetWriter
│   ├── Recording/
│   │   └── RecordingsStore.swift   ← File scanning, metadata, bulk delete
│   ├── Network/
│   │   ├── APIClient.swift         ← Actor, all endpoints, injectable URLSession
│   │   └── UploadManager.swift     ← 3-step upload flow
│   ├── Config/
│   │   └── AppConfig.swift         ← JSON persistence
│   ├── Views/
│   │   ├── RecordingsView.swift    ← List, playback, multi-select batch delete
│   │   ├── UploadView.swift        ← Upload form, folder/tag, progress
│   │   ├── SettingsView.swift      ← Server config, connection test
│   │   ├── AboutView.swift         ← Version, GitHub links
│   │   └── PermissionGuideView.swift ← Step-by-step onboarding
│   └── Utilities/
│       └── AudioPlayerManager.swift ← AVAudioPlayer wrapper
├── LyreTests/
│   ├── SmokeTests.swift            ← 1 test
│   ├── PermissionManagerTests.swift ← 4 tests
│   ├── AudioMixerTests.swift       ← 20 tests
│   ├── AudioCaptureManagerTests.swift ← 12 tests
│   ├── RecordingManagerTests.swift  ← 12 tests
│   ├── RecordingsStoreTests.swift   ← 10 tests
│   ├── AppConfigTests.swift         ← 8 tests
│   ├── APIClientTests.swift         ← 15 tests
│   ├── UploadManagerTests.swift     ← 6 tests
│   └── RecordingE2ETests.swift      ← 3 E2E tests
└── .gitignore
```

## Phased Implementation

### Phase 1 — Core Recording (MVP)

Goal: Menu bar icon → start/stop recording → M4A output with mic + system audio.

| Step | Component                | Description                              |
|------|--------------------------|------------------------------------------|
| 1.1  | Xcode project skeleton   | Target, entitlements, Info.plist, signing |
| 1.2  | PermissionManager        | Check + request screen recording & mic   |
| 1.3  | AudioCaptureManager      | ScreenCaptureKit stream setup            |
| 1.4  | AudioMixer               | Dual-stream mixing                       |
| 1.5  | RecordingManager         | State machine + AVAssetWriter encoding   |
| 1.6  | MenuBarExtra tray        | Start/Stop, device selection, quit       |
| 1.7  | Unit tests               | All Phase 1 components                   |
| 1.8  | E2E test                 | Full recording lifecycle                 |

### Phase 2 — Window UI

SwiftUI views replacing the Next.js static frontend.

| Step | Component            | Description                           |
|------|----------------------|---------------------------------------|
| 2.1  | RecordingsView       | List, playback (AVAudioPlayer), delete |
| 2.2  | SettingsView         | Server URL, token, output dir          |
| 2.3  | PermissionGuideView  | Step-by-step permission onboarding     |
| 2.4  | AboutView            | Version, GitHub link                   |

### Phase 3 — Upload & Sync

| Step | Component       | Description                              |
|------|-----------------|------------------------------------------|
| 3.1  | APIClient       | URLSession, auth, connection test        |
| 3.2  | UploadManager   | 3-step upload (presign → OSS → create)   |
| 3.3  | UploadView      | Upload form, folder/tag, progress, cancel |

### Phase 4 — Cleanup & Polish

| Step | Component       | Description                              |
|------|-----------------|------------------------------------------|
| 4.1  | Constants.swift | Extract shared constants (subsystem, audio params) |
| 4.2  | Logging         | Replace all print() with os.Logger       |
| 4.3  | Error surfacing | NSAlert for recording errors, alert for delete errors |
| 4.4  | Dead code       | Remove unused fields, fix force-unwraps  |
| 4.5  | SwiftLint       | Config + 0 production violations         |
| 4.6  | Batch delete    | Multi-select in RecordingsView           |
| 4.7  | Code signing    | Apple Development cert for TCC persistence |
| 4.8  | Full test suite | 84 tests, 0 lint violations              |

## Testing Strategy (3-Layer)

| Layer | Scope                      | Tooling             | Trigger      |
|-------|----------------------------|---------------------|--------------|
| UT    | Pure logic (mixer, config) | XCTest              | Pre-commit   |
| Lint  | Code quality               | SwiftLint           | Pre-commit   |
| E2E   | Recording pipeline         | XCTest (UI/Integration) | Pre-push |

## Progress Log

### 2026-02-26

- [x] Created planning document (this file)
- [x] Phase 1.1: Xcode project skeleton
- [x] Phase 1.2: PermissionManager
- [x] Phase 1.3: AudioCaptureManager + AudioMixer (combined commit)
- [x] Phase 1.4: AudioMixer (14 unit tests)
- [x] Phase 1.5: RecordingManager (12 unit tests)
- [x] Phase 1.6: MenuBarExtra tray UI
- [x] Phase 1.7: Unit tests (44 total: smoke + permission + mixer + capture + recording)
- [x] Phase 1.8: E2E tests (3 tests with withKnownIssue for TCC skip)
- [x] Replaced debug print() with os.Logger in PermissionManager
- [x] Removed TEST_HOST from project.yml (standalone test bundle)
- [x] Phase 2.0: AppConfig with JSON persistence (server URL, auth token, output directory) + 6 unit tests
- [x] Phase 2.1: RecordingsStore (M4A file scanning, metadata, deletion) + 10 unit tests
- [x] Phase 2.2: Main window with TabView (Recordings, Permissions, Settings, About)
- [x] Phase 2.2: RecordingsView with AudioPlayerManager (play/pause, delete confirmation)
- [x] Phase 2.2: SettingsView (server URL, auth token with show/hide, output directory picker, connection test)
- [x] Phase 2.3: PermissionGuideView (step-by-step onboarding with polling)
- [x] Phase 2.4: AboutView (version, build number, GitHub links)
- [x] Phase 2.2: "Open Lyre..." menu item in tray to open main window
- [x] Config → RecordingManager → RecordingsStore output directory sync
- [x] Phase 3.1: APIClient (actor, URLSession, all endpoints: live, presign, uploadToOSS, createRecording, listFolders, listTags)
- [x] Phase 3.2: UploadManager (3-step upload flow: presign → OSS → create, with state machine, cancel support)
- [x] Phase 3.3: UploadView (upload form with title, folder/tag picker, progress, completion)
- [x] Phase 3.3: RecordingsView updated with upload integration (context menu "Upload to Server")
- [x] Phase 3.3: MainWindowView updated to pass config to RecordingsView
- [x] APIClient made injectable (URLSession param) for unit testing with MockURLProtocol
- [x] Unit tests: APIClient (15 tests) + UploadManager (6 tests) — 84 total tests
- [x] Code signing fix: switched from ad-hoc (`-`) to Apple Development certificate (Team ID 93WWLTN9XU)
- [x] LyreTests target signing: added matching CODE_SIGN_IDENTITY, CODE_SIGN_STYLE, DEVELOPMENT_TEAM
- [x] Verified TCC permissions persist across rebuilds (Team ID + Bundle ID matching)
- [x] All 84 tests passing (81 unit + 3 E2E with known issues)
- [x] Phase 4.1: Constants.swift — extracted shared constants (subsystem, sampleRate, channelCount, bitRate, mimeType)
- [x] Phase 4.2: Replaced all 5 print() calls with os.Logger across all managers
- [x] Phase 4.3: Surface recording start/stop errors via NSAlert in TrayMenu
- [x] Phase 4.3: Surface delete errors via alert in RecordingsView
- [x] Phase 4.4: SettingsView uses APIClient.checkLive() (removed duplicated HTTP logic)
- [x] Phase 4.4: Removed dead UploadManager.description field
- [x] Phase 4.4: Fixed force-unwrap on RecordingManager.currentFileURL (guard let)
- [x] Phase 4.4: Fixed AudioPlayerManager import (SwiftUI → AVFoundation + Observation)
- [x] Phase 4.5: Created .swiftlint.yml, refactored performUpload into 3 step methods
- [x] Phase 4.5: 0 production violations, 0 serious violations across all code
- [x] Phase 4.6: Multi-select batch delete in RecordingsView (Set<URL> selection, toolbar, confirmation)
- [x] Phase 4.7: Code signing — Apple Development certificate (Team ID 93WWLTN9XU) for both targets
- [x] Phase 4.7: TCC permissions persist across rebuilds (Team ID + Bundle ID matching)
- [x] Phase 4.8: 84 tests total — all passing, 0 lint errors

### 2026-02-26 (session 2)

- [x] Audio pipeline fix: mic gain boost (2.5×), system attenuation (0.8×), tanhf() soft clipping
- [x] Audio pipeline fix: louder-channel stereo→mono downmix, consistent drain/flush formulas
- [x] Audio pipeline fix: increased drain threshold to 9600 samples (~200ms)
- [x] AudioMixerTests: 14 → 20 tests (+6 new for gain, soft clipping, consistency)
- [x] App icon: generated all macOS sizes (16–1024px) from apps/web/logo.png
- [x] Default output directory: ~/Documents → ~/Music/Lyre Recordings
- [x] Input device memory: selectedInputDeviceID persisted in AppConfig, restored on launch
- [x] Input device memory: fallback to system default when saved device unavailable
- [x] AppConfigTests: 6 → 8 tests (+2 for input device persistence)
- [x] Total: 93 tests, 0 lint violations
