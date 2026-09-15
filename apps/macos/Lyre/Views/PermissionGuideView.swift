import SwiftUI

struct PermissionGuideView: View {
    @Bindable var permissions: PermissionManager
    var isRecording = false
    var isRequestingRecording = false
    let onRecord: () -> Void
    var canReopen = false
    var reopenError: String?
    var onReopen: () -> Void = {}
    @Environment(\.lyrePreview) private var isPreview

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                LyrePageHeading(title: "Permissions", subtitle: "Make room for every voice in the conversation.")
                LyreCard {
                    HStack(spacing: 14) {
                        Image(systemName: permissions.allGranted
                              ? "checkmark.circle.fill" : "exclamationmark.shield.fill")
                            .font(.system(size: 27, weight: .light))
                            .foregroundStyle(permissions.allGranted ? LyreTheme.success : LyreTheme.warning)
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
                            unknownAction: "Check",
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
                if permissions.screenRecording == .denied || permissions.screenRecordingIssue != nil {
                    recoveryCard
                }
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "info.circle").padding(.top, 1)
                    Text("Lyre requires “Screen & System Audio Recording” in macOS Settings, "
                         + "even though it saves audio only. "
                         + "Checking access may show the macOS permission dialog.")
                        .lineSpacing(4)
                }
                .font(.system(size: 12)).foregroundStyle(.secondary)
                HStack {
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        if !isPreview { Task { await permissions.verifyRecordingAccess() } }
                    }
                    .buttonStyle(LyreButtonStyle())
                    .disabled(permissions.isRequestingScreenRecording || permissions.isRequestingMicrophone)
                    .help("Refresh microphone and system audio access")
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
    }

    private var recoveryCard: some View {
        LyreCard {
            VStack(alignment: .leading, spacing: 14) {
                Label {
                    Text("Already allowed in System Settings?")
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(LyreTheme.warning)
                }
                .font(.system(size: 14, weight: .semibold))
                Text(permissions.screenRecordingIssue.map { "The access check could not finish. \($0)" }
                     ?? "macOS has not made access available to this copy of Lyre. "
                     + "After enabling it in Settings, reopen Lyre so the new permission can take effect.")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(3)
                HStack(spacing: 10) {
                    Button("Check", systemImage: "checkmark.shield") {
                        if !isPreview { Task { await permissions.verifyRecordingAccess() } }
                    }
                    .buttonStyle(LyreButtonStyle())
                    .disabled(permissions.isRequestingScreenRecording)
                    .help("Check system audio access again")
                    Button("Reopen", systemImage: "arrow.clockwise", action: onReopen)
                        .buttonStyle(LyreButtonStyle(treatment: .accent))
                        .disabled(!canReopen || permissions.isRequestingScreenRecording)
                        .help("Reopen Lyre to apply the updated macOS permission")
                }
                if !canReopen {
                    Text("Finish any recording or upload before reopening Lyre.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if let reopenError {
                    LyreStatusLabel(title: reopenError, symbol: "exclamationmark.octagon.fill", color: LyreTheme.error)
                        .font(.system(size: 12))
                }
            }
        }
    }
}

struct PermissionRow: View {
    let title: String
    let description: String
    let symbol: String
    let status: PermissionManager.Status
    var isRequesting = false
    var unknownAction = "Allow"
    let onGrant: () -> Void
    let onOpenSettings: () -> Void

    private var statusColor: Color {
        switch status {
        case .granted: LyreTheme.success
        case .denied: LyreTheme.warning
        case .unknown: LyreTheme.accent
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            Image(systemName: symbol).font(.system(size: 23, weight: .light))
                .foregroundStyle(statusColor)
                .frame(width: 42, height: 44)
                .background(statusColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
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
                LyreStatusLabel(title: "Allowed", symbol: "checkmark.circle.fill", color: LyreTheme.success)
                    .font(.system(size: 12))
            case .denied:
                Button("Settings", systemImage: "gearshape", action: onOpenSettings)
                    .buttonStyle(LyreButtonStyle())
                    .help("Open macOS settings for \(title.lowercased()) access")
            case .unknown:
                Button(unknownAction, systemImage: "checkmark.shield", action: onGrant)
                    .buttonStyle(LyreButtonStyle(treatment: .accent))
                    .help("\(unknownAction) \(title.lowercased()) access")
            }
        }
    }
}
