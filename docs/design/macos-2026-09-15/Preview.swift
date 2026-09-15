// This executable renders the actual Lyre views with isolated, in-memory fixtures.
// No capture pipeline, network requests, real configuration, or recording files are used.
import AVFoundation
import ScreenCaptureKit
import SwiftUI

enum PreviewPage: String, CaseIterable, Identifiable {
    case library, recording, empty, permissions, permissionsReady = "permissions-ready"
    case settings, connection, appearance, upload, uploading, uploadFailed = "upload-failed", uploaded, about
    case multiple, searchEmpty = "search-empty", compact, quickRecord = "quick-record"
    case busy, compactSettings = "compact-settings", compactUpload = "compact-upload", longName = "long-name"
    case uploadEmptyFolder = "upload-empty-folder"
    case autoUploadSettings = "auto-upload-settings", autoUploading = "auto-uploading"
    case autoUploadFailed = "auto-upload-failed"
    case inputFallback = "input-fallback", inputUnavailable = "input-unavailable"
    case permissionsDenied = "permissions-denied", meetingSettings = "meeting-settings"
    case meetingStart = "meeting-start", meetingEnd = "meeting-end"
    case deleteConfirmation = "delete-confirmation", recordingError = "recording-error"
    var isReminder: Bool { self == .meetingStart || self == .meetingEnd }
    var id: String { rawValue }
    var size: NSSize {
        switch self {
        case .quickRecord: NSSize(width: 352, height: 494)
        case .compact, .compactSettings, .compactUpload, .longName: NSSize(width: 960, height: 620)
        default: NSSize(width: 1120, height: 720)
        }
    }
}

@MainActor @Observable final class PreviewFixture {
    let config: AppConfig
    let recorder: RecordingManager
    let store: RecordingsStore
    var library: RecordingLibraryState
    let meeting: MeetingDetectionSettings
    let action: RecordingActionController
    let presenter = LyreAlertPresenter()
    private var reminderTask: Task<Bool, Never>?
    var selectedTab = MainWindowView.SidebarTab.recordings
    var settingsSection = SettingsView.SectionTab.recording
    var page = PreviewPage.library
    var dark = false
    let examples: [RecordingFile]
    @ObservationIgnored weak var window: NSWindow?
    @ObservationIgnored private var started = false
    @ObservationIgnored private let defaultsDomain = "ai.hexly.lyre.design-fixture." + UUID().uuidString

    let peaks: [Float] = (0..<100).map { (index: Int) -> Float in
        let x = Double(index)
        let oscillation = abs(sin(x * 1.71) * cos(x * 0.47))
        let envelope = 0.22 + abs(sin(x * 0.079 + 0.5)) * 0.78
        return Float((0.18 + oscillation * 0.82) * envelope)
    }

    init() {
        let stateDirectory = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("fixture-state")
        config = AppConfig(configURL: stateDirectory.appendingPathComponent("config.json"))
        config.serverURL = "https://lyre.example.com"
        config.authToken = "demo-device-token"
        let directory = AppConfig.defaultOutputDirectory()
        config.outputDirectory = directory
        let permissions = PermissionManager()
        permissions.screenRecording = .granted
        permissions.microphone = .granted
        let capture = AudioCaptureManager()
        capture.inputDevicesProvider = { [AudioInputDevice(id: "demo-mic", name: "MacBook Pro Microphone")] }
        capture.defaultInputDeviceIDProvider = { "demo-mic" }
        capture.refreshDevices()
        recorder = RecordingManager(permissions: permissions, capture: capture, outputDirectory: directory)
        store = RecordingsStore(directory: directory)
        let service = PreviewRecordingService(recorder: recorder)
        action = RecordingActionController(recorder: service, recordingsStore: service, alertPresenter: service)
        library = RecordingLibraryState(config: config, startAutomaticUpload: { manager, _ in
            manager.state = .uploading(progress: 0)
        })
        meeting = MeetingDetectionSettings(defaults: UserDefaults(suiteName: defaultsDomain)!)
        examples = [
            Self.file(directory, day: 15, hour: 9, minute: 41, seconds: 1726, megabytes: 48.2),
            Self.file(directory, day: 15, hour: 8, minute: 30, seconds: 728, megabytes: 20.4),
            Self.file(directory, day: 14, hour: 16, minute: 15, seconds: 2551, megabytes: 71.3),
            Self.file(directory, day: 14, hour: 14, minute: 0, seconds: 1132, megabytes: 31.6),
            Self.file(directory, day: 14, hour: 10, minute: 5, seconds: 2174, megabytes: 60.8),
            Self.file(directory, day: 12, hour: 15, minute: 20, seconds: 1449, megabytes: 40.5)
        ]
        store.recordings = examples
        store.hasLoaded = true
        library.selection = [examples[0].url]
        library.player.state = .paused(examples[0].url)
        library.player.duration = 1726
        library.player.currentTime = 208
        if let url = Bundle.main.url(forResource: "LyreIcon", withExtension: "png"),
           let icon = NSImage(contentsOf: url) {
            icon.setName("AppIcon")
        }
    }

    private static func file(
        _ directory: URL, day: Int, hour: Int, minute: Int, seconds: Double, megabytes: Double
    ) -> RecordingFile {
        let date = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let filename = "Recording \(formatter.string(from: date)).m4a"
        return RecordingFile(url: directory.appendingPathComponent(filename),
                             fileSize: Int64(megabytes * 1_000_000), createdAt: date, duration: seconds)
    }

    func show(_ page: PreviewPage) async {
        reminderTask?.cancel()
        presenter.dismissChoice()
        presenter.dismissError()
        if action.state == .recording { await action.requestStop() }
        self.page = page
        selectedTab = .recordings
        library.closeUpload()
        library = RecordingLibraryState(config: config, startAutomaticUpload: { manager, _ in
            manager.state = .uploading(progress: 0)
        })
        config.autoUploadEnabled = [.autoUploadSettings, .autoUploading, .autoUploadFailed, .compactSettings].contains(page)
        config.autoUploadMinimumMinutes = 5
        config.authToken = page == .compactSettings ? "" : "demo-device-token"
        library.search = ""
        store.recordings = page == .empty ? [] : examples
        library.selection = page == .empty ? [] : [examples[0].url]
        library.player.state = .paused(examples[0].url)
        library.player.duration = 1726
        library.player.currentTime = 208
        recorder.permissionsObservable?.screenRecording = .granted
        recorder.permissionsObservable?.microphone = page == .permissions ? .unknown : .granted
        meeting.isEnabled = page == .meetingSettings
        if let capture = recorder.captureObservable {
            capture.selectedDeviceID = page == .inputFallback ? "demo-usb" : nil
            config.selectedInputDeviceID = capture.selectedDeviceID
            capture.inputDevicesProvider = {
                page == .inputUnavailable ? [] : [AudioInputDevice(id: "demo-mic", name: "MacBook Pro Microphone")]
            }
            capture.refreshDevices()
            capture.activeInputDevice = nil
        }
        if page == .recording || page == .quickRecord {
            await action.requestStart()
            recorder.captureObservable?.activeInputDevice = recorder.capture.availableDevices.first
            action.testingForceElapsedTick()
        }
        switch page {
        case .permissions, .permissionsReady, .permissionsDenied:
            selectedTab = .permissions
            if page == .permissionsDenied { recorder.permissionsObservable?.microphone = .denied }
        case .settings, .connection, .appearance, .compactSettings, .autoUploadSettings,
             .inputFallback, .inputUnavailable, .meetingSettings:
            selectedTab = .settings
            settingsSection = page == .connection ? .connection : page == .appearance ? .appearance : .recording
        case .about: selectedTab = .about
        case .autoUploading:
            examples.prefix(3).forEach(library.uploadAutomaticallyIfNeeded)
            library.automaticUploads[examples[1].url]?.state = .completed(recordingId: "demo-uploaded")
            library.automaticUploads[examples[2].url]?.state = .failed("The server couldn’t be reached.")
        case .autoUploadFailed:
            library.uploadAutomaticallyIfNeeded(examples[0])
            library.automaticUploads[examples[0].url]?.state = .failed(
                "The server couldn’t be reached. Check your connection and try again."
            )
            library.beginUpload(examples[0])
        case .upload, .uploading, .uploadFailed, .uploaded, .compactUpload, .uploadEmptyFolder:
            library.beginUpload(examples[0])
            let upload = library.uploadManager
            upload.title = "Product planning"
            upload.folders = [
                APIClient.Folder(id: "meetings", name: "Meetings", icon: "folder"),
                APIClient.Folder(id: "personal", name: "Personal", icon: "folder")
            ]
            upload.tags = [
                APIClient.Tag(id: "work", name: "Work"),
                APIClient.Tag(id: "ideas", name: "Ideas"),
                APIClient.Tag(id: "research", name: "Research")
            ]
            upload.selectedFolderID = "meetings"
            upload.selectedTagIDs = ["work"]
            if page == .uploading || page == .uploadEmptyFolder { upload.state = .uploading(progress: 0) }
            if page == .uploadEmptyFolder {
                store.recordings = []
                library.reconcileSelection(with: [])
            }
            if page == .uploadFailed {
                upload.state = .failed("The server couldn’t be reached. Check your connection and try again.")
            }
            if page == .uploaded { upload.state = .completed(recordingId: "demo-recording") }
        case .multiple: library.selection = Set(examples.prefix(3).map(\.url))
        case .searchEmpty:
            library.search = "No matching recording"
            library.selection = []
        case .longName:
            let file = RecordingFile(
                url: config.outputDirectory.appendingPathComponent(
                    "Quarterly planning — product strategy, customer research, and the next release milestones.m4a"
                ),
                fileSize: 48_200_000, createdAt: examples[0].createdAt, duration: 1726
            )
            store.recordings = [file] + examples
            library.selection = [file.url]
            library.player.state = .paused(file.url)
        default: break
        }
        try? await Task.sleep(for: .milliseconds(120))
        window?.contentMinSize = .zero
        window?.setContentSize(page.size)
        window?.center()
        if page.isReminder {
            reminderTask = Task { await presenter.presentChoice(
                title: page == .meetingStart ? "A meeting may be starting" : "Your meeting may have ended",
                message: page == .meetingStart
                    ? "Teams is using call audio. Record this conversation when you’re ready."
                    : "Teams call activity has stopped. Your recording is still running.",
                primary: page == .meetingStart ? "Start recording" : "Stop recording",
                secondary: page == .meetingStart ? "Not now" : "Keep recording"
            ) }
        } else if page == .recordingError {
            // Exercise the actual app-owned error sheet in this isolated host.
            NSApp.activate(ignoringOtherApps: true)
            window?.makeKeyAndOrderFront(nil)
            presenter.presentError(
                title: "Microphone not captured",
                message: "Your recording was saved with system audio. No microphone audio arrived. "
                    + "Check your input device before recording again."
            )
        }
    }

    func toggleRecording() {
        guard !recorder.permissions.needsSetup else { selectedTab = .permissions; return }
        Task {
            if action.state == .recording { await action.requestStop() }
            else { await action.requestStart(); action.testingForceElapsedTick() }
        }
    }

    func attach(_ window: NSWindow) {
        self.window = window
        guard !started else { return }
        started = true
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--render"), args.indices.contains(index + 1) {
            let output = URL(fileURLWithPath: args[index + 1], isDirectory: true)
            Task { await render(into: output) }
        }
    }

    private func render(into directory: URL) async {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let requestedPages = ProcessInfo.processInfo.environment["LYRE_PREVIEW_PAGES"]?.split(separator: ",")
            let pages = PreviewPage.allCases.filter { requestedPages?.contains(Substring($0.rawValue)) ?? true }
            for theme in ["light", "dark"] {
                dark = theme == "dark"
                // This bundle has its own preferences. Match both SwiftUI and
                // AppKit (including floating panels) to the requested fixture.
                UserDefaults.standard.set(theme, forKey: "appearance")
                NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                window?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                for page in pages {
                    await show(page)
                    try await Task.sleep(for: .milliseconds(800))
                    window?.makeFirstResponder(nil)
                    if page != .searchEmpty { library.search = "" }
                    window?.contentView?.layoutSubtreeIfNeeded()
                    if page == .meetingSettings, let content = window?.contentView {
                        scrollSettingsToBottom(content)
                        try await Task.sleep(for: .milliseconds(250))
                    }
                    if page == .compact, ProcessInfo.processInfo.environment["LYRE_PREVIEW_LAYOUT"] == "1",
                       let window, let content = window.contentView {
                        print("Compact window: \(window.frame), content: \(content.frame), minimum: \(window.contentMinSize)")
                        logSplits(content)
                    }
                    // Apple's currentProcess API only exposes content available to this
                    // process without TCC consent. The filter is further limited to our window.
                    let content = try await SCShareableContent.currentProcess
                    let capturedWindow = page.isReminder || page == .recordingError ? NSApp.windows.first {
                        $0 is NSPanel && $0.isVisible && $0.title == "Lyre"
                    } : window
                    if page.isReminder, capturedWindow?.isKeyWindow == true { throw PreviewError.reminderStoleFocus }
                    if page == .recordingError, capturedWindow?.sheetParent !== window {
                        throw PreviewError.errorSheetNotAttached
                    }
                    // Attached sheets are composited with their parent by SCK.
                    let screenshotWindow = page == .recordingError ? window : capturedWindow
                    guard let screenshotWindow, let ownWindow = content.windows.first(where: {
                        $0.windowID == CGWindowID(screenshotWindow.windowNumber)
                            && $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier
                    }) else { throw PreviewError.windowUnavailable }
                    let filter = SCContentFilter(desktopIndependentWindow: ownWindow)
                    let options = SCStreamConfiguration()
                    options.width = Int(filter.contentRect.width * 2)
                    options.height = Int(filter.contentRect.height * 2)
                    options.showsCursor = false
                    options.capturesAudio = false
                    options.ignoreShadowsSingleWindow = true
                    let capture = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: options)
                    guard let png = NSBitmapImageRep(cgImage: capture).representation(using: .png, properties: [:])
                    else { throw PreviewError.encodingFailed }
                    try png.write(to: directory.appendingPathComponent("\(page.rawValue)-\(theme).png"))
                }
            }
            UserDefaults.standard.removePersistentDomain(forName: defaultsDomain)
            UserDefaults.standard.removeObject(forKey: "appearance")
            presenter.dismissChoice()
            presenter.dismissError()
            print("Rendered \(pages.count * 2) previews from the production SwiftUI views.")
            NSApp.terminate(nil)
        } catch {
            FileHandle.standardError.write(Data("Rendering failed: \(error)\n".utf8))
            exit(1)
        }
    }

    private func logSplits(_ view: NSView) {
        if let split = view as? NSSplitView {
            print("Split \(split.frame): \(split.subviews.map(\.frame))")
        }
        view.subviews.forEach(logSplits)
    }

    private func scrollSettingsToBottom(_ view: NSView) {
        if let scroll = view as? NSScrollView, scroll.frame.width > 500, let document = scroll.documentView {
            document.scroll(NSPoint(x: 0, y: max(0, document.frame.height - scroll.contentView.bounds.height)))
            scroll.reflectScrolledClipView(scroll.contentView)
        }
        view.subviews.forEach(scrollSettingsToBottom)
    }
}

enum PreviewError: Error { case windowUnavailable, encodingFailed, reminderStoleFocus, errorSheetNotAttached }

@MainActor final class PreviewRecordingService: RecordingLifecycleManaging, RecordingsRefreshing, AlertPresenting {
    let recorder: RecordingManager
    init(recorder: RecordingManager) { self.recorder = recorder }
    var state: RecordingManager.State { recorder.state }
    var elapsedSeconds: TimeInterval { 758 }
    var lastCaptureDiagnostics: CaptureDiagnostics? { nil }
    func startRecording() async throws { recorder.state = .recording }
    func stopRecording() async throws -> URL {
        recorder.state = .idle
        return URL(fileURLWithPath: "/demo/recording.m4a")
    }
    func refresh(url: URL) async -> RecordingFile? { nil }
    func presentChoice(title: String, message: String, primary: String, secondary: String) async -> Bool { false }
    func dismissChoice() {}
    func presentError(title: String, message: String) { print("Fixture error: \(title)") }
}

@main struct LyreDesignStudy: App {
    @State private var fixture = PreviewFixture()
    var body: some Scene {
        Window("Lyre Design Study", id: "study") {
            Group {
                if fixture.page == .quickRecord {
                    TrayMenu(
                        recorder: fixture.recorder, config: fixture.config, recordingsStore: fixture.store,
                        actionController: fixture.action, onToggleRecording: fixture.toggleRecording,
                        onOpenWindow: { fixture.page = .library; fixture.selectedTab = .recordings },
                        onOpenRecording: { recording in
                            fixture.library.selection = [recording.url]
                            fixture.page = .library
                            fixture.selectedTab = .recordings
                        },
                        onOpenSettings: { fixture.page = .library; fixture.selectedTab = .settings },
                        onOpenPermissions: { fixture.page = .library; fixture.selectedTab = .permissions }
                    )
                } else {
                    MainWindowView(
                        recorder: fixture.recorder, config: fixture.config, recordingsStore: fixture.store,
                        meetingSettings: fixture.meeting, actionController: fixture.action, library: fixture.library,
                        selectedTab: $fixture.selectedTab, settingsSection: $fixture.settingsSection,
                        isRequestingRecording: fixture.page == .busy,
                        onToggleRecording: fixture.toggleRecording
                    )
                    .overlay {
                        if fixture.page == .deleteConfirmation {
                            Color.black.opacity(0.16)
                            LyreDialogView(
                                title: "Delete this recording?",
                                message: "The original file will be permanently removed from this Mac. "
                                    + "This can’t be undone.",
                                symbol: "trash", eyebrow: "YOUR LIBRARY", tone: .destructive,
                                detail: "Recording 2026-09-15 at 09.41.00.m4a",
                                primary: "Delete", secondary: "Cancel", onPrimary: {}, onSecondary: {}
                            ).shadow(color: .black.opacity(0.2), radius: 24, y: 8)
                        }
                    }
                }
            }
            .environment(\.lyrePreview, true)
            .environment(\.lyrePreviewWaveform, fixture.peaks)
            .preferredColorScheme(fixture.dark ? .dark : .light)
            .background(LyreTheme.canvas)
            .background(WindowReader { fixture.attach($0) })
        }
        .defaultSize(width: 1120, height: 720)
        .windowToolbarStyle(.unified)
        .commands {
            CommandMenu("Design Preview") {
                ForEach(PreviewPage.allCases) { page in
                    Button(page.rawValue) { Task { await fixture.show(page) } }
                }
                Divider()
                Toggle("Dark appearance", isOn: $fixture.dark).keyboardShortcut("d", modifiers: [.command, .shift])
            }
        }
    }
}

struct WindowReader: NSViewRepresentable {
    let onWindow: (NSWindow) -> Void
    func makeNSView(context: Context) -> WindowProbe {
        let view = WindowProbe()
        view.onWindow = onWindow
        return view
    }
    func updateNSView(_ nsView: WindowProbe, context: Context) {}
}

final class WindowProbe: NSView {
    var onWindow: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window { onWindow?(window) }
    }
}
