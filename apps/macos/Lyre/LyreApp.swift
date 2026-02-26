import os
import SwiftUI

@main
struct LyreApp: App {
    @State private var recorder = RecordingManager()
    @State private var config = AppConfig()
    @State private var recordingsStore: RecordingsStore?
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        // Menu bar tray
        MenuBarExtra {
            TrayMenu(recorder: recorder, onOpenWindow: { openWindow(id: "main") })
        } label: {
            TrayLabel(isRecording: recorder.state == .recording)
        }

        // Main window (opened from tray menu)
        Window("Lyre", id: "main") {
            MainWindowView(
                recorder: recorder,
                config: config,
                recordingsStore: resolvedStore
            )
            .onChange(of: config.outputDirectory) { _, newDir in
                recorder.outputDirectory = newDir
                recordingsStore = RecordingsStore(directory: newDir)
            }
            .onAppear {
                // Sync config → recorder on first launch
                recorder.outputDirectory = config.outputDirectory
                if recordingsStore == nil {
                    recordingsStore = RecordingsStore(directory: config.outputDirectory)
                }
            }
        }
        .defaultSize(width: 600, height: 500)
    }

    private var resolvedStore: RecordingsStore {
        recordingsStore ?? RecordingsStore(directory: config.outputDirectory)
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

    @State private var selectedTab: SidebarTab = .recordings

    var body: some View {
        TabView(selection: $selectedTab) {
            SwiftUI.Tab("Recordings", systemImage: "waveform", value: SidebarTab.recordings) {
                RecordingsView(store: recordingsStore, config: config)
            }

            SwiftUI.Tab("Permissions", systemImage: "shield.checkered", value: SidebarTab.permissions) {
                PermissionGuideView(permissions: recorder.permissions)
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
    var onOpenWindow: () -> Void
    @State private var elapsedTimer: Timer?
    @State private var elapsedDisplay: String = "00:00"
    @State private var hasCheckedPermissions = false

    var body: some View {
        Group {
            // Recording control
            if recorder.state == .recording {
                Text("Recording — \(elapsedDisplay)")
                    .font(.headline)

                Button("Stop Recording") {
                    Task { await stopRecording() }
                }
                .keyboardShortcut("r")
            } else {
                Button("Start Recording") {
                    Task { await startRecording() }
                }
                .keyboardShortcut("r")
                .disabled(recorder.permissions.needsSetup)
            }

            Divider()

            // Input device selector
            InputDeviceMenu(recorder: recorder)

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

            // Permissions
            if recorder.permissions.needsSetup {
                Divider()
                PermissionsMenu(permissions: recorder.permissions)
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
                }
            }
        }
    }

    // MARK: - Actions

    private func startRecording() async {
        do {
            try await recorder.startRecording()
            startElapsedTimer()
        } catch {
            Self.logger.error("Start recording failed: \(error.localizedDescription)")
            showErrorAlert(title: "Recording Failed", message: error.localizedDescription)
        }
    }

    private func stopRecording() async {
        stopElapsedTimer()
        do {
            let url = try await recorder.stopRecording()
            Self.logger.info("Recording saved: \(url.lastPathComponent)")
        } catch {
            Self.logger.error("Stop recording failed: \(error.localizedDescription)")
            showErrorAlert(title: "Recording Error", message: error.localizedDescription)
        }
    }

    /// Show an error alert to the user via NSAlert (works from menu bar apps).
    private func showErrorAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: - Elapsed Timer

    private func startElapsedTimer() {
        elapsedDisplay = "00:00"
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            let seconds = Int(recorder.elapsedSeconds)
            let mins = seconds / 60
            let secs = seconds % 60
            elapsedDisplay = String(format: "%02d:%02d", mins, secs)
        }
    }

    private func stopElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        elapsedDisplay = "00:00"
    }
}

/// Submenu for selecting microphone input device.
struct InputDeviceMenu: View {
    @Bindable var recorder: RecordingManager

    var body: some View {
        Menu("Input Device") {
            Button {
                recorder.capture.selectedDeviceID = nil
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

/// Permissions section shown when setup is needed.
struct PermissionsMenu: View {
    let permissions: PermissionManager

    var body: some View {
        if permissions.screenRecording != .granted {
            Button("Grant Screen Recording Permission…") {
                permissions.openScreenRecordingSettings()
            }
        }

        if permissions.microphone != .granted {
            Button("Grant Microphone Permission…") {
                permissions.openMicrophoneSettings()
            }
        }

        Button("Refresh Permissions") {
            Task { await permissions.checkAll() }
        }
    }
}
