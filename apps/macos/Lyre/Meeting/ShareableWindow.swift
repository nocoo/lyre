import CoreGraphics
import Foundation

/// Value-type window info consumed by `TeamsMeetingWatcher`. Kept a
/// standalone struct because `SCWindow` cannot be constructed in tests, so
/// judgement rules operate on this projection and the SCK adapter fills it in
/// production. See `docs/07-teams-meeting-detector.md` for the field contract
/// (v1.3 requires `isOnScreen` + `frame` to reject offscreen renderers and
/// undersized helpers).
struct ShareableWindow: Sendable, Equatable {
    let bundleID: String
    let title: String?
    let isOnScreen: Bool
    let frame: CGRect
}
