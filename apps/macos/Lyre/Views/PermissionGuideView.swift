import SwiftUI

struct PermissionGuideView: View {
    @Bindable var permissions: PermissionManager
    var isRecording = false
    var isRequestingRecording = false
    let onRecord: () -> Void
    @Environment(\.lyrePreview) private var isPreview

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                LyrePageHeading(title: "Permissions", subtitle: "Make room for every voice in the conversation.")
                LyreCard {
                    HStack(spacing: 14) {
                        Image(systemName: permissions.allGranted ? "checkmark.circle.fill" : "waveform")
                            .font(.system(size: 27, weight: .light))
                            .foregroundStyle(permissions.allGranted ? .green : LyreTheme.accent)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(permissions.allGranted
                                 ? "You’re ready to record." : "Two permissions. One complete recording.")
                                .font(.system(size: 15, weight: .semibold))
                            Text(permissions.allGranted
                                 ? "System audio and microphone access are both allowed."
                                 : "Allow system audio and microphone access to capture both sides.")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                }
                LyreSection(title: "Recording access") {
                    VStack(spacing: 20) {
                        PermissionRow(
                            title: "System audio",
                            description: "Capture the audio playing on this Mac, including other meeting participants.",
                            symbol: "speaker.wave.2",
                            status: permissions.screenRecording,
                            isRequesting: permissions.isRequestingScreenRecording,
                            onGrant: { if !isPreview { Task { await permissions.requestScreenRecording() } } },
                            onOpenSettings: { if !isPreview { permissions.openScreenRecordingSettings() } }
                        )
                        Divider()
                        PermissionRow(
                            title: "Microphone",
                            description: "Capture your voice through the selected microphone.",
                            symbol: "mic",
                            status: permissions.microphone,
                            isRequesting: permissions.isRequestingMicrophone,
                            onGrant: { if !isPreview { Task { await permissions.requestMicrophone() } } },
                            onOpenSettings: { if !isPreview { permissions.openMicrophoneSettings() } }
                        )
                    }
                }
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "info.circle").padding(.top, 1)
                    Text("macOS calls system audio access “Screen & System Audio Recording.” Lyre saves audio only. "
                         + "If macOS asks you to reopen Lyre after granting access, finish any recording first.")
                        .lineSpacing(4)
                }
                .font(.system(size: 12)).foregroundStyle(.secondary)
                HStack {
                    Button("Refresh status", systemImage: "arrow.clockwise") {
                        if !isPreview { Task { await permissions.refreshStatusWithoutPrompt() } }
                    }
                    .buttonStyle(LyreButtonStyle())
                    Spacer()
                    if permissions.allGranted {
                        LyreRecordingButton(
                            isRecording: isRecording, isBusy: isRequestingRecording, action: onRecord
                        )
                    }
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(LyreTheme.pageInset)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .task {
            guard !isPreview else { return }
            while !Task.isCancelled {
                await permissions.refreshStatusWithoutPrompt()
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            if !isPreview { Task { await permissions.refreshStatusWithoutPrompt() } }
        }
    }
}

struct PermissionRow: View {
    let title: String
    let description: String
    let symbol: String
    let status: PermissionManager.Status
    var isRequesting = false
    let onGrant: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            Image(systemName: symbol).font(.system(size: 23, weight: .light))
                .foregroundStyle(LyreTheme.accent)
                .frame(width: 42, height: 44)
                .background(LyreTheme.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 7) {
                Text(title).font(.system(size: 14, weight: .semibold))
                Text(description).font(.system(size: 12)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true).lineSpacing(3)
            }
            Spacer(minLength: 12)
            statusControl.frame(width: 124, alignment: .trailing)
        }
    }

    @ViewBuilder private var statusControl: some View {
        if isRequesting {
            ProgressView().controlSize(.small).accessibilityLabel("Waiting for permission")
        } else {
            switch status {
            case .granted:
                Label("Allowed", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 12)).foregroundStyle(.green)
            case .denied:
                Button("Open Settings", action: onOpenSettings).buttonStyle(LyreButtonStyle())
            case .unknown:
                Button("Allow access…", action: onGrant).buttonStyle(LyreButtonStyle(treatment: .accent))
            }
        }
    }
}
