import SwiftUI

/// Quick controls only. Every destination opens in the same main window.
struct TrayMenu: View {
    @Bindable var recorder: RecordingManager
    @Bindable var config: AppConfig
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var actionController: RecordingActionController
    var isRequestingRecording = false
    let onToggleRecording: () -> Void
    let onOpenWindow: () -> Void
    let onOpenRecording: (RecordingFile) -> Void
    let onOpenSettings: () -> Void
    let onOpenPermissions: () -> Void
    @Environment(\.lyrePreview) private var isPreview
    @AppStorage("appearance") private var appearance = "system"

    private var isRecording: Bool { actionController.state == .recording }

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 9) {
                LyreBrandMark(size: 32)
                Text("Lyre").font(.system(size: 16, weight: .semibold))
                Spacer()
                HStack(spacing: 6) {
                    Circle().fill(isRecording ? LyreTheme.recording : .secondary.opacity(0.5))
                        .frame(width: 6, height: 6)
                    Text(isRecording ? "Recording" : recorder.permissions.needsSetup ? "Setup needed" : "Ready")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            VStack(spacing: 7) {
                Text(actionController.elapsedDisplay)
                    .font(.system(size: 40, weight: .light, design: .monospaced))
                    .contentTransition(.numericText())
                Text("System audio + microphone").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .padding(.vertical, 3)
            LyreRecordingButton(
                isRecording: isRecording,
                isBusy: isRequestingRecording,
                fillsWidth: true,
                action: onToggleRecording
            )
            VStack(alignment: .leading, spacing: 8) {
                InputDevicePicker(recorder: recorder, config: config).frame(maxWidth: .infinity)
                    .help("Automatic follows macOS. Picker changes apply to the next recording.")
                InputDeviceStatus(recorder: recorder)
            }
            if recorder.permissions.needsSetup {
                Button("Set up recording access…", action: onOpenPermissions)
                    .font(.system(size: 12)).buttonStyle(.plain).foregroundStyle(LyreTheme.accent)
            }
            Divider()
            if let recording = recordingsStore.recordings.first {
                Button { onOpenRecording(recording) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "waveform").foregroundStyle(LyreTheme.accent)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("LATEST RECORDING").font(.system(size: 10, weight: .semibold))
                                .tracking(0.6).foregroundStyle(.secondary)
                            Text(recording.detailTitle).font(.system(size: 12)).lineLimit(1)
                            Text(recording.formattedDuration).font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                Text("Your recordings will appear in the library.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack(spacing: 14) {
                Button("Recordings", action: openMainWindow)
                Spacer(minLength: 0)
                Button("Settings", systemImage: "gearshape", action: onOpenSettings).labelStyle(.iconOnly)
                Button("Show recordings folder", systemImage: "folder") {
                    if !isPreview {
                        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: config.outputDirectory.path)
                    }
                }.labelStyle(.iconOnly)
                Button("Quit") { if !isPreview { NSApp.terminate(nil) } }
            }
            .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(.secondary)
        }
        .padding(20).frame(width: 332)
        .background(LyreTheme.canvas).tint(LyreTheme.accent)
        .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
        .task {
            guard !isPreview else { return }
            if let permissions = recorder.permissionsObservable { await permissions.refreshStatusWithoutPrompt() }
            recorder.capture.refreshDevices()
            if !recordingsStore.hasLoaded { await recordingsStore.scan() }
        }
    }

    private func openMainWindow() {
        onOpenWindow()
        NSApp.activate(ignoringOtherApps: true)
    }
}
