import SwiftUI

/// About view showing app version and links.
struct AboutView: View {
    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

    var body: some View {
        VStack(spacing: 20) {
            // App icon
            if let icon = NSImage(named: "AppIcon") {
                Image(nsImage: icon)
                    .resizable()
                    .frame(width: 96, height: 96)
            }

            // App name and version
            VStack(spacing: 4) {
                Text("Lyre")
                    .font(.title)
                    .fontWeight(.bold)

                Text("Version \(appVersion) (\(buildNumber))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Description
            Text("Meeting recorder for macOS.\nCaptures system audio and microphone.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .font(.body)

            Divider()
                .frame(width: 200)

            // Links
            VStack(spacing: 8) {
                Link(destination: URL(string: "https://github.com/nicoxiang/lyre")!) {
                    Label("GitHub Repository", systemImage: "link")
                }

                Link(destination: URL(string: "https://github.com/nicoxiang/lyre/issues")!) {
                    Label("Report an Issue", systemImage: "exclamationmark.bubble")
                }
            }

            Spacer()

            Text("Copyright 2026 Lyre Contributors")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(30)
        .frame(minWidth: 350, minHeight: 350)
    }
}
