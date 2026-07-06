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
        // Default on for the fresh-install case: the whole point of the
        // feature is to unblock the missed-recording scenarios described in
        // the spec, so opting-out is the exception.
        if defaults.object(forKey: defaultsKey) == nil {
            defaults.set(true, forKey: defaultsKey)
        }
        self.isEnabled = defaults.bool(forKey: defaultsKey)
    }
}
