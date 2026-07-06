import os
import SwiftUI

@main
struct LyreApp: App {
    @State private var recorder: RecordingManager
    @State private var config: AppConfig
    @State private var recordingsStore: RecordingsStore
    @State private var actionController: RecordingActionController
    @State private var selectedTab: MainWindowView.SidebarTab = .recordings
    @Environment(\.openWindow) private var openWindow

    init() {
        let cfg = AppConfig()
        let mgr = RecordingManager()
        mgr.outputDirectory = cfg.outputDirectory
        let store = RecordingsStore(directory: cfg.outputDirectory)
        let presenter = NSAlertPresenter()
        let action = RecordingActionController(
            recorder: mgr,
            recordingsStore: store,
            alertPresenter: presenter
        )
        _config = State(initialValue: cfg)
        _recorder = State(initialValue: mgr)
        _recordingsStore = State(initialValue: store)
        _actionController = State(initialValue: action)
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

        // Main window (opened from tray menu)
        Window("Lyre", id: "main") {
            MainWindowView(
                recorder: recorder,
                config: config,
                recordingsStore: resolvedStore,
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
                SettingsView(config: config)
            }

            SwiftUI.Tab("About", systemImage: "info.circle", value: SidebarTab.about) {
                AboutView()
            }
        }
    }
}

/// The tray dropdown menu.
struct TrayMenu: View {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "TrayMenu")

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
                    recorder.capture.refreshDevices()
                    restoreSavedInputDevice()
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

    // MARK: - Actions

    /// Restore saved input device from config, falling back to default if unavailable.
    private func restoreSavedInputDevice() {
        if let savedID = config.selectedInputDeviceID {
            let available = recorder.capture.availableDevices.contains { $0.id == savedID }
            if available {
                recorder.capture.selectedDeviceID = savedID
            } else {
                Self.logger.info("Saved input device \(savedID) no longer available, using default")
                config.selectedInputDeviceID = nil
                recorder.capture.selectedDeviceID = nil
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
