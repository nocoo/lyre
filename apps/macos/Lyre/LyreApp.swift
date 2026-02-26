import SwiftUI

@main
struct LyreApp: App {
    var body: some Scene {
        MenuBarExtra("Lyre", systemImage: "waveform") {
            Text("Lyre is running")
                .padding()
            Divider()
            Button("Quit Lyre") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }
}
