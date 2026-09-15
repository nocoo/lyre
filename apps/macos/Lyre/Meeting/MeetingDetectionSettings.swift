import Foundation
import Observation

/// UserDefaults-backed toggle for the Teams meeting detector. Deliberately
/// tiny: it only stores the enabled flag; watcher / coordinator lifecycle
/// belongs to `LyreApp` (see docs/07-teams-meeting-detector.md — LyreApp is
/// the single lifecycle owner, this class knows nothing about them).
@Observable
@MainActor
final class MeetingDetectionSettings {
    private let defaultsKey = "meeting.detection.enabled"
    private let defaults: UserDefaults

    var isEnabled: Bool {
        didSet { defaults.set(isEnabled, forKey: defaultsKey) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Optional reminders start off. Preserve an existing user's choice.
        self.isEnabled = defaults.bool(forKey: defaultsKey)
    }
}
