import CoreGraphics
import Foundation

/// Value-type window info consumed by `TeamsMeetingWatcher`. Kept a
/// standalone struct because `SCWindow` cannot be constructed in tests, so
/// judgement rules operate on this projection and the SCK adapter fills it in
/// production. Offscreen meeting windows remain evidence across Spaces;
/// the frame still filters out tiny helper windows.
struct ShareableWindow: Sendable, Equatable {
    let bundleID: String
    let title: String?
    let isOnScreen: Bool
    let frame: CGRect
}
