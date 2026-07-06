import Foundation
import Testing
@testable import Lyre

/// Unit tests for `MeetingDetectionSettings`. Verifies the fresh-install
/// default (on), persistence round-trip, and idempotent honouring of a
/// pre-existing UserDefaults value.
@MainActor
@Suite("MeetingDetectionSettings Tests")
struct MeetingDetectionSettingsTests {
    private static let key = "meeting.detection.enabled"

    @Test func freshInstall_defaultsToEnabled() {
        let defaults = Self.emptyDefaults()
        let settings = MeetingDetectionSettings(defaults: defaults)

        #expect(settings.isEnabled == true)
        #expect(defaults.bool(forKey: Self.key) == true)
    }

    @Test func existingDisabledValue_isRestored() {
        let defaults = Self.emptyDefaults()
        defaults.set(false, forKey: Self.key)

        let settings = MeetingDetectionSettings(defaults: defaults)

        #expect(settings.isEnabled == false)
    }

    @Test func togglingIsEnabled_persistsToDefaults() {
        let defaults = Self.emptyDefaults()
        let settings = MeetingDetectionSettings(defaults: defaults)

        settings.isEnabled = false
        #expect(defaults.bool(forKey: Self.key) == false)

        settings.isEnabled = true
        #expect(defaults.bool(forKey: Self.key) == true)
    }

    /// Isolated UserDefaults suite so tests never touch the app's global
    /// preferences (and vice versa when other tests run in the same process).
    private static func emptyDefaults() -> UserDefaults {
        let suiteName = "MeetingDetectionSettingsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}
