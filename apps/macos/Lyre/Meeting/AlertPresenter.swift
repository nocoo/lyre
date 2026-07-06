import AppKit

/// Abstraction over `NSAlert` so `RecordingActionController` and
/// `MeetingPromptCoordinator` can both post user-visible alerts without
/// carrying a hard dependency on `NSAlert` in unit tests. See
/// docs/07-teams-meeting-detector.md for the design rationale.
@MainActor
protocol AlertPresenting {
    /// Present a two-button modal alert. Returns `true` when the user picks
    /// the primary button; returns `false` for the secondary button as well as
    /// Esc / Cmd-W / closing the window — anything short of an explicit
    /// primary confirmation.
    func presentChoice(title: String, message: String, primary: String, secondary: String) -> Bool

    /// Present a single-button error alert. Fire-and-forget.
    func presentError(title: String, message: String)
}

/// Production `NSAlert`-backed presenter. Menu bar apps (LSUIElement) can call
/// `NSAlert.runModal()` without an active main window, so this stays as a thin
/// wrapper without extra window plumbing.
@MainActor
final class NSAlertPresenter: AlertPresenting {
    func presentChoice(
        title: String,
        message: String,
        primary: String,
        secondary: String
    ) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: primary)   // .alertFirstButtonReturn
        alert.addButton(withTitle: secondary) // .alertSecondButtonReturn
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn
    }

    func presentError(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
