import SwiftUI

struct SettingsView: View {
    @Bindable var config: AppConfig
    @Bindable var meetingSettings: MeetingDetectionSettings
    @Bindable var recorder: RecordingManager
    @Binding var section: SectionTab
    let onOpenPermissions: () -> Void
    @Environment(\.lyrePreview) private var isPreview
    @AppStorage("appearance") private var appearance = "system"
    @State private var showTokenField = false
    @State private var connectionStatus = ConnectionStatus.untested

    enum SectionTab: String, CaseIterable {
        case recording = "Recording", connection = "Connection", appearance = "Appearance"
    }
    enum ConnectionStatus {
        case untested, testing, success(String), failed(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                LyrePageHeading(title: "Settings", subtitle: "Make Lyre fit the way you record.")
                Picker("Settings section", selection: $section) {
                    ForEach(SectionTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().controlSize(.large)
                .fixedSize().frame(maxWidth: .infinity, alignment: .leading)
                switch section {
                case .recording: recordingSettings
                case .connection: connectionSettings
                case .appearance: appearanceSettings
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(LyreTheme.pageInset)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .onChange(of: config.serverURL) { _, _ in connectionStatus = .untested }
        .onChange(of: config.authToken) { _, _ in connectionStatus = .untested }
    }

    @ViewBuilder private var recordingSettings: some View {
        LyreSection(title: "Audio", subtitle: "Capture the conversation from both sides.") {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Label { Text("Microphone") } icon: { Image(systemName: "mic").frame(width: 18) }
                        .font(.system(size: 13))
                    Spacer()
                    InputDevicePicker(recorder: recorder, config: config)
                        .frame(maxWidth: 280, alignment: .trailing)
                }
                Divider()
                HStack {
                    Label { Text("System audio") } icon: {
                        Image(systemName: "speaker.wave.2").frame(width: 18)
                    }
                    .font(.system(size: 13))
                    Spacer()
                    LyreStatusLabel(title: "Included", symbol: "checkmark.circle.fill", color: LyreTheme.success)
                        .font(.system(size: 12))
                }
                InputDeviceStatus(recorder: recorder)
                Text("Automatic follows your macOS input, including during recording. "
                     + "A saved microphone reconnects automatically. Picker changes apply to the next recording.")
                    .font(.system(size: 11)).foregroundStyle(.secondary).lineSpacing(3)
            }
        }
        automaticUploadSettings
        LyreSection(title: "Recording files") {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Save recordings to").font(.system(size: 13, weight: .medium))
                        Text(config.outputDirectory.abbreviatingWithTildeInPath)
                            .font(.system(size: 12)).foregroundStyle(.secondary).textSelection(.enabled)
                            .lineLimit(2).truncationMode(.middle)
                    }
                    Spacer(minLength: 0)
                    Button("Choose", systemImage: "folder.badge.plus", action: chooseOutputDirectory)
                        .buttonStyle(LyreButtonStyle()).help("Choose where to save recordings")
                }
                Divider()
                Button("Reveal", systemImage: "folder") {
                    if !isPreview {
                        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: config.outputDirectory.path)
                    }
                }
                .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(LyreTheme.accent)
                .help("Show the recordings folder in Finder")
            }
        }
        LyreSection(title: "Meeting reminders") {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Detect Teams meetings").font(.system(size: 13, weight: .medium))
                    Spacer()
                    Toggle("Detect Teams meetings", isOn: $meetingSettings.isEnabled)
                        .labelsHidden().toggleStyle(.switch)
                }
                Text("Show a quiet, temporary reminder when Teams call activity is detected. "
                     + "Ending reminders appear only for recordings started from a meeting reminder. "
                     + "Lyre never starts or stops recording automatically.")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(3)
            }
        }
        HStack {
            Label("System audio and microphone permissions", systemImage: "checkmark.shield")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            Spacer()
            Button("Permissions", systemImage: "checkmark.shield", action: onOpenPermissions)
                .buttonStyle(LyreButtonStyle()).help("Review microphone and system audio access")
        }
    }

    private var automaticUploadSettings: some View {
        LyreSection(title: "Automatic uploads") {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Automatically upload recordings").font(.system(size: 13, weight: .medium))
                    Spacer()
                    Toggle("Automatically upload recordings", isOn: $config.autoUploadEnabled)
                        .labelsHidden().toggleStyle(.switch)
                }
                Divider()
                HStack(spacing: 10) {
                    Text("Longer than").font(.system(size: 13))
                    Spacer()
                    TextField("Upload threshold in minutes", value: $config.autoUploadMinimumMinutes, format: .number)
                        .textFieldStyle(.roundedBorder).controlSize(.large)
                        .multilineTextAlignment(.trailing).frame(width: 64)
                    Text("min").font(.system(size: 12)).foregroundStyle(.secondary)
                    Stepper("Upload threshold in minutes", value: $config.autoUploadMinimumMinutes,
                            in: AppConfig.autoUploadMinuteRange)
                        .labelsHidden().fixedSize()
                }
                .disabled(!config.autoUploadEnabled)
                Text("After you stop, recordings longer than this limit upload to Lyre. Originals stay on this Mac.")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(3)
                if config.autoUploadEnabled && !config.isServerConfigured {
                    HStack(spacing: 12) {
                        LyreStatusLabel(title: "Connect to Lyre to enable uploads.",
                                        symbol: "exclamationmark.triangle.fill", color: LyreTheme.warning)
                            .font(.system(size: 12))
                        Spacer(minLength: 0)
                        Button("Connect", systemImage: "link") { section = .connection }
                            .buttonStyle(LyreButtonStyle()).help("Configure the Lyre connection")
                    }
                }
            }
        }
    }

    @ViewBuilder private var connectionSettings: some View {
        LyreSection(
            title: "Lyre server",
            subtitle: "Connect when you’re ready to upload. Local recording works without a server."
        ) {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Server URL").font(.system(size: 12, weight: .medium))
                    TextField("Server URL", text: $config.serverURL, prompt: Text(AppConfig.defaultServerURL))
                        .labelsHidden().textFieldStyle(.roundedBorder).controlSize(.large)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Device token").font(.system(size: 12, weight: .medium))
                    HStack(spacing: 8) {
                        Group {
                            if showTokenField {
                                TextField("Device token", text: $config.authToken, prompt: Text("Bearer token"))
                            } else {
                                SecureField("Device token", text: $config.authToken, prompt: Text("Bearer token"))
                            }
                        }
                        .labelsHidden().textFieldStyle(.roundedBorder).controlSize(.large)
                        Button(showTokenField ? "Hide token" : "Show token",
                               systemImage: showTokenField ? "eye.slash" : "eye") { showTokenField.toggle() }
                            .labelStyle(.iconOnly).buttonStyle(LyreButtonStyle(iconOnly: true))
                    }
                }
                Text("Create a token under Device Tokens in the Lyre web app, then paste it here.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
        LyreSection(title: "Connection status") {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Server availability").font(.system(size: 13, weight: .medium))
                        statusBadge
                    }
                    Spacer()
                    Button("Test", systemImage: "network", action: testConnection)
                        .buttonStyle(LyreButtonStyle()).disabled(!canTest)
                        .help("Test whether the Lyre server is reachable")
                }
                Divider()
                HStack {
                    Text("Device token").font(.system(size: 12))
                    Spacer()
                    LyreStatusLabel(
                        title: config.authToken.isEmpty ? "Not configured" : "Not verified by this check",
                        symbol: config.authToken.isEmpty ? "exclamationmark.triangle.fill" : "info.circle",
                        color: config.authToken.isEmpty ? LyreTheme.warning : .secondary
                    )
                    .font(.system(size: 12))
                }
            }
        }
        Text("The connection test checks whether the server is reachable. "
             + "Authentication is checked when you load folders, tags, or upload.")
            .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(3)
    }

    private var appearanceSettings: some View {
        LyreSection(title: "Appearance", subtitle: "Choose a look, or let Lyre change with your Mac.") {
            VStack(alignment: .leading, spacing: 18) {
                Picker("Appearance", selection: $appearance) {
                    Text("Follow macOS").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented).labelsHidden().controlSize(.large)
                .fixedSize().frame(maxWidth: .infinity, alignment: .leading)
                Text("Following macOS keeps Lyre in step with your system’s light and dark appearance.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
    }

    private var canTest: Bool {
        if case .testing = connectionStatus { return false }
        return !config.serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder private var statusBadge: some View {
        switch connectionStatus {
        case .untested:
            LyreStatusLabel(title: "Not checked", symbol: "minus.circle", color: .secondary)
                .font(.system(size: 12))
        case .testing:
            HStack(spacing: 8) {
                ProgressView().controlSize(.mini)
                Text("Checking server…").font(.system(size: 12)).foregroundStyle(.secondary)
            }
        case .success(let version):
            LyreStatusLabel(title: "Reachable · v\(version)", symbol: "checkmark.circle.fill", color: LyreTheme.success)
                .font(.system(size: 12))
        case .failed(let error):
            LyreStatusLabel(title: error, symbol: "exclamationmark.octagon.fill", color: LyreTheme.error)
                .font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func testConnection() {
        if isPreview {
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
            connectionStatus = .success(version)
            return
        }
        let server = config.serverURL
        let token = config.authToken
        connectionStatus = .testing
        Task {
            do {
                let response = try await APIClient(baseURL: server, authToken: token).checkLive()
                guard server == config.serverURL, token == config.authToken else { return }
                connectionStatus = .success(response.version ?? "unknown")
            } catch {
                guard server == config.serverURL, token == config.authToken else { return }
                connectionStatus = .failed(error.localizedDescription)
            }
        }
    }

    private func chooseOutputDirectory() {
        guard !isPreview else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.directoryURL = config.outputDirectory
        panel.prompt = "Choose"
        panel.message = "Select the directory where recordings will be saved."
        if panel.runModal() == .OK, let url = panel.url { config.outputDirectory = url }
    }
}

struct InputDevicePicker: View {
    @Bindable var recorder: RecordingManager
    @Bindable var config: AppConfig
    @Environment(\.lyrePreview) private var isPreview

    var body: some View {
        Picker("Microphone", selection: Binding(
            get: { recorder.capture.selectedDeviceID },
            set: {
                recorder.capture.selectedDeviceID = $0
                config.selectedInputDeviceID = $0
            }
        )) {
            Text("Automatic · Follow macOS").tag(String?.none)
            if let selected = recorder.capture.selectedDeviceID,
               !recorder.capture.availableDevices.contains(where: { $0.id == selected }) {
                Text("Saved microphone · Disconnected").tag(Optional(selected))
            }
            ForEach(recorder.capture.availableDevices) { device in
                Text(device.name).tag(Optional(device.id))
            }
        }
        .labelsHidden().pickerStyle(.menu).controlSize(.large)
        .onAppear {
            if !isPreview { recorder.capture.refreshDevices() }
        }
    }
}

struct InputDeviceStatus: View {
    @Bindable var recorder: RecordingManager

    private var status: LyreStatusLabel {
        guard let capture = recorder.captureObservable else {
            return LyreStatusLabel(title: "Automatic follows the input selected in macOS.",
                                   symbol: "info.circle", color: .secondary)
        }
        if let error = capture.inputRoutingError {
            return LyreStatusLabel(title: error, symbol: "exclamationmark.octagon.fill", color: LyreTheme.error)
        }
        if recorder.state == .recording {
            guard let device = capture.activeInputDevice else {
                return LyreStatusLabel(title: "Waiting for a microphone…",
                                       symbol: "exclamationmark.triangle.fill", color: LyreTheme.warning)
            }
            return LyreStatusLabel(title: "Recording with \(device.name)",
                                   symbol: "mic.fill", color: LyreTheme.recording)
        }
        let route = capture.resolvedInputDevice
        guard let device = capture.availableDevices.first(where: { $0.id == route.effectiveID }) else {
            return LyreStatusLabel(title: "No microphone available. Connect one or check macOS Sound settings.",
                                   symbol: "mic.slash.fill", color: LyreTheme.warning)
        }
        if route.selectedID != nil && route.source != .saved {
            return LyreStatusLabel(title: "Using \(device.name) until your saved microphone reconnects.",
                                   symbol: "exclamationmark.triangle.fill", color: LyreTheme.warning)
        }
        return LyreStatusLabel(title: "Input: \(device.name)", symbol: "mic.fill", color: LyreTheme.success)
    }

    var body: some View {
        status
            .font(.system(size: 11))
            .fixedSize(horizontal: false, vertical: true).lineSpacing(3)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension URL {
    var abbreviatingWithTildeInPath: String { (path as NSString).abbreviatingWithTildeInPath }
}
