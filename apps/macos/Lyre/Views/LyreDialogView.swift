import SwiftUI

/// Shared layout for app-owned confirmations, errors and optional reminders.
struct LyreDialogView: View {
    enum Tone { case standard, caution, error, destructive }

    let title: String
    let message: String
    var symbol = "waveform"
    var eyebrow = "LYRE"
    var tone: Tone = .standard
    var detail: String?
    var isReminder = false
    let primary: String
    var primarySymbol = "checkmark"
    var secondary: String?
    let onPrimary: () -> Void
    var onSecondary: () -> Void = {}
    @AppStorage("appearance") private var appearance = "system"

    private var color: Color {
        switch tone {
        case .standard: LyreTheme.accent
        case .caution: LyreTheme.warning
        case .error, .destructive: LyreTheme.error
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: 21, weight: .medium))
                    .foregroundStyle(color).frame(width: 44, height: 44)
                    .background(color.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                Text(eyebrow).font(.system(size: 10, weight: .semibold)).tracking(1.3)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if isReminder {
                    Button("Dismiss reminder", systemImage: "xmark", action: onSecondary)
                        .labelStyle(.iconOnly).buttonStyle(LyreButtonStyle(iconOnly: true))
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(.system(size: 21, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                Text(message).font(.system(size: 13)).foregroundStyle(.secondary)
                    .lineSpacing(4).fixedSize(horizontal: false, vertical: true)
            }
            if let detail {
                Label(detail, systemImage: "waveform")
                    .font(.system(size: 12)).lineLimit(3).truncationMode(.middle)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(LyreTheme.control, in: RoundedRectangle(cornerRadius: 8))
            }
            if isReminder {
                Text("This reminder dismisses automatically.")
                    .font(.system(size: 11)).foregroundStyle(.tertiary)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                if let secondary {
                    Button(action: onSecondary) {
                        Label(secondary, systemImage: "xmark").frame(minWidth: 64)
                    }
                    .buttonStyle(LyreButtonStyle())
                    .keyboardShortcut(tone == .destructive ? .defaultAction : .cancelAction)
                }
                if tone == .destructive {
                    primaryButton
                } else {
                    primaryButton.keyboardShortcut(.defaultAction)
                }
            }
            .padding(.top, 4)
        }
        .padding(24).frame(width: 440)
        .background(LyreTheme.canvas, in: RoundedRectangle(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(LyreTheme.separator, lineWidth: 1) }
        .tint(LyreTheme.accent)
        .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
        .onExitCommand { if secondary != nil { onSecondary() } else { onPrimary() } }
    }

    private var primaryButton: some View {
        Button(action: onPrimary) {
            Label(primary, systemImage: primarySymbol).frame(minWidth: 80)
        }
        .buttonStyle(LyreButtonStyle(treatment: tone == .destructive ? .recording : .accent))
    }
}
