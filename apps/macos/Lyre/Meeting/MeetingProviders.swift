import AppKit
import Foundation
import ScreenCaptureKit

/// Test seam for "is Teams running in the process table?". `NSWorkspace` is
/// the production impl; tests inject an in-memory fake.
@MainActor
protocol RunningAppsProviding {
    func isBundleRunning(anyOf ids: Set<String>) -> Bool
}

/// Test seam for `SCShareableContent`. Production impl calls SCK; tests inject
/// an array of `ShareableWindow` values.
@MainActor
protocol ShareableContentProviding {
    func currentTeamsWindows(bundleIDs: Set<String>) async throws -> [ShareableWindow]
}

/// Coordinator-facing seam that carries the debounced meeting state stream
/// (`MeetingPromptCoordinator` consumes this; the concrete watcher conforms).
@MainActor
protocol MeetingEventProviding: AnyObject {
    var meetingEvents: AsyncStream<Bool> { get }
}

// MARK: - Production providers

/// Real `NSWorkspace` adapter.
@MainActor
final class NSWorkspaceRunningAppsProvider: RunningAppsProviding {
    func isBundleRunning(anyOf ids: Set<String>) -> Bool {
        NSWorkspace.shared.runningApplications.contains {
            guard let bid = $0.bundleIdentifier else { return false }
            return ids.contains(bid)
        }
    }
}

/// Real `SCShareableContent` adapter. Projects each Teams window into the
/// `ShareableWindow` value type so the judgement rules stay pure.
@MainActor
final class SCShareableContentProvider: ShareableContentProviding {
    func currentTeamsWindows(bundleIDs: Set<String>) async throws -> [ShareableWindow] {
        let content = try await SCShareableContent.current
        return content.windows.compactMap { win -> ShareableWindow? in
            guard let bid = win.owningApplication?.bundleIdentifier,
                  bundleIDs.contains(bid) else { return nil }
            return ShareableWindow(
                bundleID: bid,
                title: win.title,
                isOnScreen: win.isOnScreen,
                frame: win.frame
            )
        }
    }
}
