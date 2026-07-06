import SwiftUI

/// Settings view for configuring server connection and recording preferences.
struct SettingsView: View {
    @Bindable var config: AppConfig
    @Bindable var meetingSettings: MeetingDetectionSettings
    @State private var showTokenField = false
    @State private var connectionStatus: ConnectionStatus = .untested

    enum ConnectionStatus {
        case untested
        case testing
        case success(String) // server version
        case failed(String) // error message
    }

    var body: some View {
        Form {
            // Server Connection
            Section("Server Connection") {
                TextField("Server URL", text: $config.serverURL, prompt: Text(AppConfig.defaultServerURL))
                    .textFieldStyle(.roundedBorder)

                HStack {
                    if showTokenField {
                        TextField("Auth Token", text: $config.authToken, prompt: Text("Bearer token"))
                            .textFieldStyle(.roundedBorder)
                    } else {
                        SecureField("Auth Token", text: $config.authToken, prompt: Text("Bearer token"))
                            .textFieldStyle(.roundedBorder)
                    }
                    Button {
                        showTokenField.toggle()
                    } label: {
                        Image(systemName: showTokenField ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.plain)
                    .help(showTokenField ? "Hide token" : "Show token")
                }

                HStack {
                    Button("Test Connection") {
                        testConnection()
                    }
                    .disabled(!config.isServerConfigured)

                    statusBadge
                }
            }

            // Recording
            Section("Recording") {
                HStack {
                    Text("Output Directory")
                    Spacer()
                    Text(config.outputDirectory.abbreviatingWithTildeInPath)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button("Choose...") {
                        chooseOutputDirectory()
                    }
                }

                Button("Open in Finder") {
                    NSWorkspace.shared.selectFile(
                        nil,
                        inFileViewerRootedAtPath: config.outputDirectory.path
                    )
                }
            }

            // Meeting detection (Teams)
            Section("Meeting Detection") {
                Toggle(
                    "Detect Teams meetings and prompt to record",
                    isOn: $meetingSettings.isEnabled
                )
                Text(
                    """
                    When enabled, Lyre pops up a small confirmation when a Microsoft Teams \
                    meeting starts or ends. Lyre never starts or stops recording without \
                    your confirmation.
                    """
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 400, minHeight: 250)
    }

    // MARK: - Connection Test

    @ViewBuilder
    private var statusBadge: some View {
        switch connectionStatus {
        case .untested:
            EmptyView()
        case .testing:
            ProgressView()
                .controlSize(.small)
        case .success(let version):
            Label("Connected (v\(version))", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption)
        case .failed(let error):
            Label(error, systemImage: "xmark.circle.fill")
                .foregroundStyle(.red)
                .font(.caption)
                .lineLimit(1)
        }
    }

    private func testConnection() {
        connectionStatus = .testing
        Task {
            do {
                let client = APIClient(
                    baseURL: config.serverURL,
                    authToken: config.authToken
                )
                let response = try await client.checkLive()
                connectionStatus = .success(response.version ?? "unknown")
            } catch {
                connectionStatus = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Directory Picker

    private func chooseOutputDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.directoryURL = config.outputDirectory
        panel.prompt = "Choose"
        panel.message = "Select the directory where recordings will be saved."

        if panel.runModal() == .OK, let url = panel.url {
            config.outputDirectory = url
        }
    }
}

// MARK: - URL Extension

extension URL {
    /// Abbreviate path with ~ for home directory, like Finder does.
    var abbreviatingWithTildeInPath: String {
        (path as NSString).abbreviatingWithTildeInPath
    }
}
