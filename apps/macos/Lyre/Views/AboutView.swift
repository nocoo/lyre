import SwiftUI

struct AboutView: View {
    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
    }
    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                LyrePageHeading(title: "About Lyre", subtitle: "Keep the conversation. Come back to what matters.")
                LyreCard(padding: 36) {
                    VStack(spacing: 22) {
                        LyreBrandMark(size: 110)
                        VStack(spacing: 9) {
                            Text("Lyre").font(.system(size: 32, weight: .semibold))
                            Text("Version \(appVersion) (\(buildNumber))")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Text("Meeting recorder for macOS.\nCaptures system audio and microphone.")
                            .font(.system(size: 14)).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center).lineSpacing(5)
                        HStack(spacing: 12) {
                            Link(destination: URL(string: "https://github.com/nocoo/lyre")!) {
                                Label("GitHub Repository", systemImage: "arrow.up.right.square")
                            }
                            Link(destination: URL(string: "https://github.com/nocoo/lyre/issues")!) {
                                Label("Report an Issue", systemImage: "bubble.left")
                            }
                        }
                        .buttonStyle(LyreButtonStyle()).padding(.top, 4)
                        Divider().padding(.vertical, 4)
                        Text("Copyright 2026 Lyre Contributors")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(LyreTheme.pageInset)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
}
