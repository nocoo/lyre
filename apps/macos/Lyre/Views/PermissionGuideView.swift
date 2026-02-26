import SwiftUI

/// Step-by-step permission onboarding view.
///
/// Shows the status of each required permission with buttons to grant or
/// open System Settings. Polls for permission changes and auto-advances.
struct PermissionGuideView: View {
    @Bindable var permissions: PermissionManager
    @State private var pollTimer: Timer?

    var body: some View {
        VStack(spacing: 24) {
            // Header
            VStack(spacing: 8) {
                Image(systemName: "shield.checkered")
                    .font(.system(size: 40))
                    .foregroundStyle(.blue)

                Text("Permissions Required")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Lyre needs two permissions to record meeting audio.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Divider()

            // Permission steps
            VStack(spacing: 16) {
                PermissionRow(
                    title: "Screen & System Audio Recording",
                    description: "Captures audio from other meeting participants via speaker output.",
                    status: permissions.screenRecording,
                    onGrant: {
                        Task { await permissions.requestScreenRecording() }
                    },
                    onOpenSettings: {
                        permissions.openScreenRecordingSettings()
                    }
                )

                PermissionRow(
                    title: "Microphone",
                    description: "Captures your voice during the meeting.",
                    status: permissions.microphone,
                    onGrant: {
                        Task { await permissions.requestMicrophone() }
                    },
                    onOpenSettings: {
                        permissions.openMicrophoneSettings()
                    }
                )
            }

            Spacer()

            if permissions.allGranted {
                Label("All permissions granted. You're ready to record!", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .fontWeight(.medium)
            } else {
                Button("Refresh Status") {
                    Task { await permissions.checkAll() }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(24)
        .frame(minWidth: 420, minHeight: 350)
        .onAppear { startPolling() }
        .onDisappear { stopPolling() }
    }

    // MARK: - Polling

    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            Task { await permissions.checkAll() }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}

/// A single permission row with status indicator and action button.
struct PermissionRow: View {
    let title: String
    let description: String
    let status: PermissionManager.Status
    var onGrant: () -> Void
    var onOpenSettings: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Status icon
            statusIcon
                .font(.system(size: 20))
                .frame(width: 24, height: 24)

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .fontWeight(.medium)
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Action
            switch status {
            case .granted:
                Text("Granted")
                    .font(.caption)
                    .foregroundStyle(.green)
                    .fontWeight(.medium)
            case .denied:
                Button("Open Settings") { onOpenSettings() }
                    .controlSize(.small)
            case .unknown:
                Button("Grant") { onGrant() }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch status {
        case .granted:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .denied:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
        case .unknown:
            Image(systemName: "questionmark.circle")
                .foregroundStyle(.orange)
        }
    }
}
