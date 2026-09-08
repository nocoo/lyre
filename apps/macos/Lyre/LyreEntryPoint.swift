import SwiftUI

@main
enum LyreEntryPoint {
    @MainActor
    static func main() {
        #if DEBUG
        if NativeTestPolicy.isTestHost(environment: ProcessInfo.processInfo.environment) {
            NativeTestPolicy.markEmptyHostStarted()
            LyreNativeTestHost.main()
            return
        }
        #endif
        LyreApp.main()
    }
}

#if DEBUG
/// Hosted tests need an application process, but not the user's application state.
private struct LyreNativeTestHost: App {
    var body: some Scene {
        Settings { EmptyView() }
    }
}
#endif
