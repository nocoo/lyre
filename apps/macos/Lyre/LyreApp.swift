import SwiftUI

@main
struct LyreApp: App {
    @State private var recorder = RecordingManager()

    var body: some Scene {
        MenuBarExtra {
            TrayMenu(recorder: recorder)
        } label: {
            TrayLabel(isRecording: recorder.state == .recording)
        }
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

/// The tray dropdown menu.
struct TrayMenu: View {
    @Bindable var recorder: RecordingManager
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
            print("[TrayMenu] Start recording failed: \(error.localizedDescription)")
        }
    }

    private func stopRecording() async {
        stopElapsedTimer()
        do {
            let url = try await recorder.stopRecording()
            print("[TrayMenu] Recording saved: \(url.lastPathComponent)")
        } catch {
            print("[TrayMenu] Stop recording failed: \(error.localizedDescription)")
        }
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
