#if DEBUG
import Foundation

enum NativeTestPolicy {
    enum LiveRecordingError: Error, Equatable {
        case notEnabled
        case permissionsUnavailable
    }

    @MainActor private(set) static var emptyHostStarted = false

    @MainActor
    static func markEmptyHostStarted() {
        emptyHostStarted = true
    }

    static func isTestHost(environment: [String: String]) -> Bool {
        environment["LYRE_TEST_HOST"] == "1"
            || !(environment["XCTestConfigurationFilePath"] ?? "").isEmpty
    }

    static func liveRecordingEnabled(environment: [String: String]) -> Bool {
        environment["LYRE_RUN_LIVE_RECORDING"] == "1"
    }

    /// The opt-in check precedes even a read-only permission probe.
    static func requireLiveRecording(
        environment: [String: String],
        permissions: () async -> Bool
    ) async throws {
        guard liveRecordingEnabled(environment: environment) else {
            throw LiveRecordingError.notEnabled
        }
        guard await permissions() else {
            throw LiveRecordingError.permissionsUnavailable
        }
    }
}
#endif
