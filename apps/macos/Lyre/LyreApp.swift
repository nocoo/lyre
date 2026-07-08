import os
import SwiftUI

@main
struct LyreApp: App {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "LyreApp")

    @State private var recorder: RecordingManager
    @State private var config: AppConfig
    @State private var recordingsStore: RecordingsStore
    @State private var actionController: RecordingActionController
    @State private var meetingSettings: MeetingDetectionSettings
    @State private var meetingWatcher: TeamsMeetingWatcher
    @State private var meetingCoordinator: MeetingPromptCoordinator
    @State private var selectedTab: MainWindowView.SidebarTab = .recordings
    @Environment(\.openWindow) private var openWindow

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
        let presenter = NSAlertPresenter()
        let action = RecordingActionController(
            recorder: mgr,
            recordingsStore: store,
            alertPresenter: presenter
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
    }

    var body: some Scene {
        // Menu bar tray
        MenuBarExtra {
            TrayMenu(
                recorder: recorder,
                config: config,
                recordingsStore: resolvedStore,
                actionController: actionController,
                onOpenWindow: { openWindow(id: "main") },
                onOpenPermissions: {
                    selectedTab = .permissions
                    openWindow(id: "main")
                    NSApp.activate(ignoringOtherApps: true)
                }
            )
        } label: {
            TrayLabel(isRecording: recorder.state == .recording)
        }

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
                selectedTab: $selectedTab
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
        .defaultSize(width: 600, height: 500)
    }

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

/// The main window content with tab navigation.
struct MainWindowView: View {
    @Bindable var recorder: RecordingManager
    @Bindable var config: AppConfig
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var meetingSettings: MeetingDetectionSettings

    enum SidebarTab: Hashable {
        case recordings
        case permissions
        case settings
        case about
    }

    @Binding var selectedTab: SidebarTab

    var body: some View {
        TabView(selection: $selectedTab) {
            SwiftUI.Tab("Recordings", systemImage: "waveform", value: SidebarTab.recordings) {
                RecordingsView(store: recordingsStore, config: config)
            }

            SwiftUI.Tab("Permissions", systemImage: "shield.checkered", value: SidebarTab.permissions) {
                if let pm = recorder.permissionsObservable {
                    PermissionGuideView(permissions: pm)
                } else {
                    Text("Permissions surface unavailable")
                }
            }

            SwiftUI.Tab("Settings", systemImage: "gearshape", value: SidebarTab.settings) {
                SettingsView(config: config, meetingSettings: meetingSettings)
            }

            SwiftUI.Tab("About", systemImage: "info.circle", value: SidebarTab.about) {
                AboutView()
            }
        }
    }
}

/// The tray dropdown menu.
struct TrayMenu: View {
    @Bindable var recorder: RecordingManager
    @Bindable var config: AppConfig
    @Bindable var recordingsStore: RecordingsStore
    /// Owned by LyreApp; the tray reads state / elapsedDisplay from here and
    /// delegates start/stop to it. See docs/07-teams-meeting-detector.md C4.
    @Bindable var actionController: RecordingActionController
    var onOpenWindow: () -> Void
    var onOpenPermissions: () -> Void
    @State private var hasCheckedPermissions = false

    var body: some View {
        Group {
            // Recording control
            if actionController.state == .recording {
                Text("Recording — \(actionController.elapsedDisplay)")
                    .font(.headline)

                Button("Stop Recording") {
                    Task { await actionController.requestStop() }
                }
                .keyboardShortcut("r")
            } else {
                Button("Start Recording") {
                    Task { await actionController.requestStart() }
                }
                .keyboardShortcut("r")
                .disabled(recorder.permissions.needsSetup)

                if recorder.permissions.needsSetup {
                    Button("Setup Permissions…") {
                        onOpenPermissions()
                    }
                }
            }

            Divider()

            // Input device selector
            InputDeviceMenu(recorder: recorder, config: config)

            Divider()

            // Open main window
            Button("Open Lyre...") {
                onOpenWindow()
                NSApp.activate(ignoringOtherApps: true)
            }
            .keyboardShortcut(",")

            // Output folder
            Button("Show Recordings in Finder") {
                NSWorkspace.shared.selectFile(
                    nil,
                    inFileViewerRootedAtPath: recorder.outputDirectory.path
                )
            }

            Divider()

            Button("Quit Lyre") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .onAppear {
            if !hasCheckedPermissions {
                hasCheckedPermissions = true
                Task {
                    await recorder.permissions.checkAll()
                    // Refresh here too so the visible device list picks up
                    // hardware added since app launch; the saved-id restore
                    // itself already ran in LyreApp.init.
                    recorder.capture.refreshDevices()
                }
            }
        }
        .onChange(of: recorder.capture.selectedDeviceID) { _, newValue in
            // Sync config when capture manager auto-resets (e.g. device unplugged)
            if newValue == nil, config.selectedInputDeviceID != nil {
                let stillExists = recorder.capture.availableDevices.contains {
                    $0.id == config.selectedInputDeviceID
                }
                if !stillExists {
                    config.selectedInputDeviceID = nil
                }
            }
        }
    }
}

/// Submenu for selecting microphone input device.
struct InputDeviceMenu: View {
    @Bindable var recorder: RecordingManager
    @Bindable var config: AppConfig

    var body: some View {
        Menu("Input Device") {
            Button {
                recorder.capture.selectedDeviceID = nil
                config.selectedInputDeviceID = nil
            } label: {
                HStack {
                    Text("System Default")
                    if recorder.capture.selectedDeviceID == nil {
                        Spacer()
                        Image(systemName: "checkmark")
                    }
                }
            }

            if !recorder.capture.availableDevices.isEmpty {
                Divider()
                ForEach(recorder.capture.availableDevices) { device in
                    Button {
                        recorder.capture.selectedDeviceID = device.id
                        config.selectedInputDeviceID = device.id
                    } label: {
                        HStack {
                            Text(device.name)
                            if recorder.capture.selectedDeviceID == device.id {
                                Spacer()
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            recorder.capture.refreshDevices()
        }
    }
}
