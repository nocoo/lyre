import os
import SwiftUI

struct LyreApp: App {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "LyreApp")

    @State private var recorder: RecordingManager
    @State private var config: AppConfig
    @State private var recordingsStore: RecordingsStore
    @State private var actionController: RecordingActionController
    @State private var meetingSettings: MeetingDetectionSettings
    @State private var meetingWatcher: TeamsMeetingWatcher
    @State private var meetingCoordinator: MeetingPromptCoordinator
    @State private var library: RecordingLibraryState
    @State private var isRequestingRecording = false
    @State private var selectedTab: MainWindowView.SidebarTab = .recordings
    @State private var settingsSection: SettingsView.SectionTab = .recording
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.lyreSearch) private var searchRecordings

    init() {
        let cfg = AppConfig()
        let mgr = RecordingManager()
        mgr.outputDirectory = cfg.outputDirectory
        // Restore saved input device before any recording entry point can
        // fire (menu bar hotkey, meeting prompt, etc.), so a user who
        // never opens the tray still gets the device they last picked.
        // Previously this ran on TrayMenu.onAppear, which meant hotkey /
        // meeting-prompt starts silently reverted to auto.
        InputDeviceRestore.restore(config: cfg, capture: mgr.capture)
        let store = RecordingsStore(directory: cfg.outputDirectory)
        let library = RecordingLibraryState(config: cfg)
        let presenter = LyreAlertPresenter()
        let action = RecordingActionController(
            recorder: mgr,
            recordingsStore: store,
            alertPresenter: presenter,
            onRecordingSaved: library.uploadAutomaticallyIfNeeded
        )
        let mtgSettings = MeetingDetectionSettings()

        // Meeting detector: LyreApp is the sole lifecycle owner.
        // - Coordinator starts once and stays alive for the app's lifetime;
        //   it swallows in-flight events when settings.isEnabled == false.
        // - Watcher's start()/suspend()/resume() is driven by the Settings
        //   toggle so a disabled detector performs no polling or SCK reads
        //   (docs/07-teams-meeting-detector.md C8).
        let watcher = TeamsMeetingWatcher(
            runningApps: NSWorkspaceRunningAppsProvider(),
            content: SCShareableContentProvider(),
            permissions: mgr.permissions
        )
        let coordinator = MeetingPromptCoordinator(
            watcher: watcher,
            action: action,
            alertPresenter: presenter,
            settings: mtgSettings
        )
        action.onStateChange = { [weak coordinator] in coordinator?.recordingStateDidChange() }
        Task { @MainActor in await mgr.permissions.checkAll() }
        coordinator.start()
        if mtgSettings.isEnabled {
            watcher.start()
            Self.logger.info("Meeting detector started (enabled)")
        } else {
            Self.logger.info("Meeting detector kept idle (settings disabled)")
        }

        _config = State(initialValue: cfg)
        _recorder = State(initialValue: mgr)
        _recordingsStore = State(initialValue: store)
        _actionController = State(initialValue: action)
        _meetingSettings = State(initialValue: mtgSettings)
        _meetingWatcher = State(initialValue: watcher)
        _meetingCoordinator = State(initialValue: coordinator)
        _library = State(initialValue: library)
    }

    var body: some Scene {
        // Menu bar tray
        MenuBarExtra {
            TrayMenu(
                recorder: recorder,
                config: config,
                recordingsStore: resolvedStore,
                actionController: actionController,
                isRequestingRecording: recordingBusy,
                onToggleRecording: toggleRecording,
                onOpenWindow: { navigate(to: .recordings) },
                onOpenRecording: { recording in
                    if library.canLeaveUpload {
                        library.closeUpload()
                        library.selection = [recording.url]
                    }
                    navigate(to: .recordings)
                },
                onOpenSettings: { navigate(to: .settings) },
                onOpenPermissions: { navigate(to: .permissions) }
            )
        } label: {
            TrayLabel(isRecording: recorder.state == .recording)
        }
        .menuBarExtraStyle(.window)

        // Main window (opened from tray menu). The `.onChange` observers
        // live here because this scene is guaranteed to be materialised
        // whenever the user can flip a Setting — SettingsView lives inside
        // MainWindowView. MenuBarExtra's popover content only lives while
        // the menu is open, so it is not a reliable place to observe the
        // meeting-detector toggle (Reviewer C8 blocker).
        Window("Lyre", id: "main") {
            MainWindowView(
                recorder: recorder,
                config: config,
                recordingsStore: resolvedStore,
                meetingSettings: meetingSettings,
                actionController: actionController,
                library: library,
                selectedTab: $selectedTab,
                settingsSection: $settingsSection,
                isRequestingRecording: recordingBusy,
                onToggleRecording: toggleRecording
            )
            .onChange(of: config.outputDirectory) { _, newDir in
                recorder.outputDirectory = newDir
                let newStore = RecordingsStore(directory: newDir)
                recordingsStore = newStore
                // Keep the controller pointing at the current store so
                // post-stop refresh lands on the visible list rather than
                // the stale directory's list.
                actionController.setRecordingsStore(newStore)
            }
            .onChange(of: meetingSettings.isEnabled) { _, isEnabled in
                meetingCoordinator.settingsDidChange()
                // Sole lifecycle switch for the watcher. `suspend()` tears
                // down the timer + NSWorkspace observers without finishing
                // the stream, so the coordinator's consumer parks safely
                // and picks up again on resume without needing to be
                // recreated.
                if isEnabled {
                    meetingWatcher.resume()
                    Self.logger.info("Meeting detector resumed by user toggle")
                } else {
                    meetingWatcher.suspend()
                    Self.logger.info("Meeting detector suspended by user toggle")
                }
            }
        }
        .defaultSize(width: 1120, height: 720)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { navigate(to: .settings) }.keyboardShortcut(",")
            }
            CommandGroup(replacing: .appInfo) {
                Button("About Lyre") { navigate(to: .about) }
            }
            CommandGroup(after: .textEditing) {
                Button("Find Recordings") { searchRecordings?() }
                    .keyboardShortcut("f")
                    .disabled(searchRecordings == nil)
            }
            CommandMenu("Recording") {
                Button(actionController.state == .recording ? "Stop Recording" : "Start Recording") {
                    toggleRecording()
                }
                .keyboardShortcut("r")
                .disabled(recordingBusy)
                Divider()
                Button("Show Recordings") { navigate(to: .recordings) }.keyboardShortcut("1")
                Button("Recording Permissions") { navigate(to: .permissions) }.keyboardShortcut("2")
            }
        }
    }

    private func navigate(to tab: MainWindowView.SidebarTab) {
        selectedTab = tab
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }

    private func toggleRecording() {
        guard !recordingBusy else { return }
        isRequestingRecording = true
        Task {
            defer { isRequestingRecording = false }
            if actionController.state == .recording {
                await actionController.requestStop()
            } else {
                await recorder.permissions.checkAll()
                guard !recorder.permissions.needsSetup else {
                    navigate(to: .permissions)
                    return
                }
                await actionController.requestStart()
            }
        }
    }

    private var recordingBusy: Bool { isRequestingRecording || actionController.isBusy }

    private var resolvedStore: RecordingsStore {
        recordingsStore
    }
}

/// The tray icon label — switches between idle and recording icons.
struct TrayLabel: View {
    let isRecording: Bool

    var body: some View {
        Image(isRecording ? "TrayIconRecording" : "TrayIcon")
            .renderingMode(.template)
    }
}
