import SwiftUI

/// A small native palette shared by the window, player, forms, and tray.
enum LyreTheme {
    static let accent = adaptive("accent", light: 0x995020, dark: 0xEFAC77)
    static let canvas = adaptive("canvas", light: 0xF5F4F0, dark: 0x191A18)
    static let surface = adaptive("surface", light: 0xFFFFFF, dark: 0x232522)
    static let control = adaptive("control", light: 0xEDECE7, dark: 0x30332E)
    static let recording = adaptive("recording", light: 0xB63F35, dark: 0xFF9286)
    static let separator = Color.primary.opacity(0.09)
    static let controlHeight: CGFloat = 32
    static let pageInset: CGFloat = 28

    private static func adaptive(_ name: String, light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: NSColor.Name("Lyre.\(name)")) { appearance in
            let hex = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(
                srgbRed: CGFloat((hex >> 16) & 255) / 255,
                green: CGFloat((hex >> 8) & 255) / 255,
                blue: CGFloat(hex & 255) / 255,
                alpha: 1
            )
        })
    }
}

extension EnvironmentValues {
    /// Used only by the isolated native design fixture, never set by LyreApp.
    @Entry var lyrePreview = false
    @Entry var lyrePreviewWaveform: [Float] = []
}

struct LyreButtonStyle: ButtonStyle {
    enum Treatment { case standard, accent, recording }
    var treatment: Treatment = .standard
    var iconOnly = false

    func makeBody(configuration: Configuration) -> some View {
        LyreButtonBody(configuration: configuration, treatment: treatment, iconOnly: iconOnly)
    }
}

private struct LyreButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let treatment: LyreButtonStyle.Treatment
    let iconOnly: Bool
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovered = false

    private var fill: Color {
        switch treatment {
        case .standard: LyreTheme.control
        case .accent: LyreTheme.accent
        case .recording: LyreTheme.recording
        }
    }

    var body: some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .lineLimit(1)
            .padding(.horizontal, iconOnly ? 0 : 12)
            .frame(width: iconOnly ? LyreTheme.controlHeight : nil, height: LyreTheme.controlHeight)
            .foregroundStyle(treatment == .standard ? Color.primary : LyreTheme.surface)
            .background(fill, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.1 : hovered ? 0.045 : 0))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(LyreTheme.separator.opacity(treatment == .standard ? 1 : 0), lineWidth: 0.5)
            }
            .opacity(isEnabled ? 1 : 0.45)
            .onHover { hovered = $0 }
    }
}

struct LyreCard<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LyreTheme.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12).strokeBorder(LyreTheme.separator, lineWidth: 1)
            }
    }
}

struct LyreSection<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.system(size: 14, weight: .semibold))
                if let subtitle {
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
            LyreCard { content }
        }
    }
}

struct LyrePageHeading: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 26, weight: .semibold))
            Text(subtitle).font(.system(size: 13)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LyreBrandMark: View {
    var size: CGFloat = 32

    var body: some View {
        if let icon = NSImage(named: "AppIcon") {
            Image(nsImage: icon)
                .resizable()
                .interpolation(.high)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "bird")
                .font(.system(size: size * 0.6))
                .foregroundStyle(LyreTheme.accent)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }
}

struct LyreRecordingButton: View {
    let isRecording: Bool
    var isBusy = false
    var fillsWidth = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Group {
                    if isBusy {
                        ProgressView().controlSize(.mini).tint(LyreTheme.surface)
                    } else {
                        Image(systemName: isRecording ? "stop.fill" : "record.circle")
                            .font(.system(size: 14, weight: .medium))
                    }
                }
                .frame(width: 16, height: 16)
                Text(isBusy ? "Please wait…" : isRecording ? "Stop recording" : "Record")
            }
            .frame(width: fillsWidth ? nil : 120)
            .frame(maxWidth: fillsWidth ? .infinity : nil)
        }
        .buttonStyle(LyreButtonStyle(treatment: isRecording ? .recording : .accent))
        .disabled(isBusy)
        .help(isRecording ? "Stop recording (⌘R)" : "Start recording (⌘R)")
    }
}

extension ToolbarContent {
    /// These controls already have a surface; retain the native toolbar without double bezels.
    @ToolbarContentBuilder func lyreToolbarControl() -> some ToolbarContent {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            self.sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
        #else
        self
        #endif
    }
}
