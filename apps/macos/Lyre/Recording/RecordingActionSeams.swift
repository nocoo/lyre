import Foundation

/// Narrow seams used by `RecordingActionController` so unit tests can drive it
/// with lightweight fakes without subclassing the concrete `RecordingManager`
/// or `RecordingsStore` (both are `final class`).
///
/// The protocols are intentionally minimal — they carry only the surface that
/// the controller uses; wider testing seams for `RecordingManager` itself live
/// in `Audio/RecordingDependencies.swift`.

@MainActor
protocol RecordingLifecycleManaging: AnyObject {
    var state: RecordingManager.State { get }
    var elapsedSeconds: TimeInterval { get }
    func startRecording() async throws
    @discardableResult func stopRecording() async throws -> URL
}

extension RecordingManager: RecordingLifecycleManaging {}

@MainActor
protocol RecordingsRefreshing: AnyObject {
    func refresh(url: URL) async
}

extension RecordingsStore: RecordingsRefreshing {}
