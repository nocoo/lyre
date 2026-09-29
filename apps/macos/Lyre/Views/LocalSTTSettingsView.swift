import SwiftUI

struct LocalSTTSettingsView: View {
    @Bindable var config: AppConfig
    @Environment(\.lyrePreview) private var isPreview

    var body: some View {
        LyreSection(title: "Local speech recognition",
                    subtitle: "Transcribe on this Mac before manual and automatic uploads.") {
            VStack(alignment: .leading, spacing: 16) {
                Toggle("Use local STT", isOn: $config.localSTT.enabled).toggleStyle(.switch)
                Text("If local recognition fails, Lyre uploads the audio for server transcription. "
                     + "Cancelling stops both recognition and upload.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                Divider()
                pathField("whisper-cli", path: $config.localSTT.executablePath)
                pathField("Model", path: $config.localSTT.modelPath)
                HStack(spacing: 16) {
                    Text("Language").font(.system(size: 13))
                    TextField("auto", text: $config.localSTT.language)
                        .textFieldStyle(.roundedBorder).frame(width: 90)
                    Text("CPU threads").font(.system(size: 13))
                    Stepper(value: $config.localSTT.threads, in: 1...64) {
                        Text("\(config.localSTT.threads)").monospacedDigit().frame(width: 24)
                    }
                    Spacer()
                    Toggle("Metal GPU", isOn: $config.localSTT.useGPU).toggleStyle(.switch)
                }
                Text("Use auto to detect language, or a language code such as en or zh. "
                     + "Audio tracks are mixed to 16 kHz mono WAV. JSON preserves sentence timestamps; "
                     + "TXT, SRT and logs stay in .lyre-stt beside the original recording.")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(3)
                Button("Show STT files", systemImage: "folder") {
                    guard !isPreview else { return }
                    let directory = config.outputDirectory.appendingPathComponent(".lyre-stt", isDirectory: true)
                    if FileManager.default.fileExists(atPath: directory.path) {
                        NSWorkspace.shared.open(directory)
                    } else {
                        NSWorkspace.shared.open(config.outputDirectory)
                    }
                }
                .buttonStyle(LyreButtonStyle())
            }
        }
    }

    private func pathField(_ title: String, path: Binding<String>) -> some View {
        HStack(spacing: 12) {
            Text(title).font(.system(size: 13)).frame(width: 90, alignment: .leading)
            TextField(title, text: path).textFieldStyle(.roundedBorder).controlSize(.large)
            Button("Choose") {
                guard !isPreview else { return }
                let panel = NSOpenPanel()
                panel.canChooseFiles = true
                panel.canChooseDirectories = false
                panel.allowsMultipleSelection = false
                panel.directoryURL = URL(fileURLWithPath: (path.wrappedValue as NSString).expandingTildeInPath)
                    .deletingLastPathComponent()
                if panel.runModal() == .OK, let url = panel.url { path.wrappedValue = url.path }
            }
            .buttonStyle(LyreButtonStyle())
        }
    }
}
