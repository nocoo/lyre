import SwiftUI

/// One persistent container for the library, upload workflow, permissions, settings, and About.
struct MainWindowView: View {
    @Bindable var recorder: RecordingManager
    @Bindable var config: AppConfig
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var meetingSettings: MeetingDetectionSettings
    @Bindable var actionController: RecordingActionController
    @Bindable var library: RecordingLibraryState
    @Binding var selectedTab: SidebarTab
    @Binding var settingsSection: SettingsView.SectionTab
    var isRequestingRecording = false
    let onToggleRecording: () -> Void
    @Environment(\.lyrePreview) private var isPreview
    @AppStorage("appearance") private var appearance = "system"
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    enum SidebarTab: String, CaseIterable, Identifiable {
        case recordings, permissions, settings, about
        var id: String { rawValue }
        var title: String {
            switch self {
            case .recordings: "Recordings"
            case .permissions: "Permissions"
            case .settings: "Settings"
            case .about: "About Lyre"
            }
        }
        var symbol: String {
            switch self {
            case .recordings: "waveform"
            case .permissions: "checkmark.shield"
            case .settings: "slider.horizontal.3"
            case .about: "info.circle"
            }
        }
    }

    private var sidebarSelection: Binding<SidebarTab?> {
        Binding(get: { selectedTab }, set: { if let tab = $0 { selectedTab = tab } })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
                .navigationSplitViewColumnWidth(min: 212, ideal: 212, max: 212)
        } detail: {
            workspace
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(LyreTheme.canvas)
        }
        .navigationSplitViewStyle(.balanced)
        .navigationTitle(selectedTab.title)
        .tint(LyreTheme.accent)
        .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
        .frame(minWidth: 960, minHeight: 620)
        .toolbar {
            ToolbarItem(placement: .automatic) { recordingStatus }.lyreToolbarControl()
            ToolbarItem(placement: .primaryAction) {
                LyreRecordingButton(
                    isRecording: actionController.state == .recording,
                    isBusy: isRequestingRecording,
                    action: onToggleRecording
                )
            }.lyreToolbarControl()
        }
        .task(id: ObjectIdentifier(recordingsStore)) {
            guard !isPreview else { return }
            await recorder.permissionsObservable?.refreshStatusWithoutPrompt()
            recordingsStore.startWatching()
            await recordingsStore.scan()
            guard !Task.isCancelled else { return }
            library.reconcileSelection(with: recordingsStore.recordings)
        }
        .onChange(of: recordingsStore.recordings.map(\.url)) { _, _ in
            library.reconcileSelection(with: recordingsStore.recordings)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            guard !isPreview else { return }
            Task { await recorder.permissions.checkAll() }
            recorder.capture.refreshDevices()
        }
        .onDisappear {
            recordingsStore.stopWatching()
            library.player.stop()
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                LyreBrandMark(size: 38)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Lyre").font(.system(size: 19, weight: .semibold))
                    Text("Keep the conversation").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 24)

            List(selection: sidebarSelection) {
                Section {
                    navigationRow(.recordings)
                }
                Section("Application") {
                    navigationRow(.permissions)
                    navigationRow(.settings)
                    navigationRow(.about)
                }
            }
            .listStyle(.sidebar)
            .scrollDisabled(true)

            if library.isUploading {
                Button {
                    selectedTab = .recordings
                } label: {
                    HStack(spacing: 9) {
                        ProgressView().controlSize(.mini)
                        Text("Uploading recording…").font(.system(size: 11))
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.system(size: 10))
                    }
                    .padding(12)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12).padding(.bottom, 10)
            }
            Divider().padding(.horizontal, 18)
            Button {
                guard !isPreview else { return }
                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: config.outputDirectory.path)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "folder").font(.system(size: 16))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Recordings folder").font(.system(size: 12, weight: .medium))
                        Text(config.outputDirectory.abbreviatingWithTildeInPath)
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                            .lineLimit(1).truncationMode(.middle)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
                .padding(18)
            }
            .buttonStyle(.plain)
            .help("Show recordings folder in Finder")
        }
    }

    private func navigationRow(_ tab: SidebarTab) -> some View {
        HStack(spacing: 10) {
            Image(systemName: tab.symbol).font(.system(size: 14))
                .frame(width: 18)
            Text(tab.title).font(.system(size: 13, weight: selectedTab == tab ? .semibold : .regular))
            Spacer(minLength: 4)
            if tab == .recordings {
                Text("\(recordingsStore.recordings.count)")
                    .font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
            }
            if tab == .permissions && recorder.permissions.needsSetup {
                Image(systemName: "circle.fill")
                    .font(.system(size: 6)).foregroundStyle(.orange)
                    .accessibilityLabel("Setup needed")
            }
        }
        .padding(.vertical, 7)
        .tag(tab)
    }

    @ViewBuilder private var workspace: some View {
        switch selectedTab {
        case .recordings:
            RecordingsView(
                store: recordingsStore,
                config: config,
                library: library,
                isRecording: actionController.state == .recording,
                isRequestingRecording: isRequestingRecording,
                onRecord: onToggleRecording,
                onOpenSettings: {
                    settingsSection = .connection
                    selectedTab = .settings
                }
            )
        case .permissions:
            if let permissions = recorder.permissionsObservable {
                PermissionGuideView(
                    permissions: permissions,
                    isRecording: actionController.state == .recording,
                    isRequestingRecording: isRequestingRecording,
                    onRecord: onToggleRecording
                )
            } else {
                ContentUnavailableView("Permissions unavailable", systemImage: "checkmark.shield")
            }
        case .settings:
            SettingsView(
                config: config, meetingSettings: meetingSettings, recorder: recorder, section: $settingsSection
            ) {
                selectedTab = .permissions
            }
        case .about:
            AboutView()
        }
    }

    private var recordingStatus: some View {
        HStack(spacing: 8) {
            if isRequestingRecording {
                Text(actionController.state == .recording ? "Saving recording…" : "Starting recording…")
                    .foregroundStyle(.secondary)
            } else if actionController.state == .recording {
                Circle().fill(LyreTheme.recording).frame(width: 7, height: 7)
                Text("Recording").fontWeight(.medium)
                Text(actionController.elapsedDisplay).monospacedDigit().frame(minWidth: 42, alignment: .leading)
                if let capture = recorder.captureObservable {
                    if let error = capture.inputRoutingError {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            .help(error).accessibilityLabel(error)
                    } else if let device = capture.activeInputDevice {
                        Text(device.name).foregroundStyle(.secondary).lineLimit(1).frame(maxWidth: 150)
                    }
                }
            } else {
                Image(systemName: "waveform").foregroundStyle(.tertiary)
                Text(recorder.permissions.needsSetup ? "Permissions needed" : "Ready to record")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.system(size: 12))
        .padding(.trailing, 8)
        .accessibilityElement(children: .combine)
    }
}
