import AVFoundation
import CoreMedia
import ScreenCaptureKit

/// Test seams for `RecordingManager`. The production types
/// (`PermissionManager`, `AudioCaptureManager`, `AudioEncoder`) conform
/// directly so the GUI keeps talking to the concrete classes; the
/// `RecordingManager` itself uses the protocol type so tests can
/// inject fakes without going near SCK / CoreAudio / AVFoundation.
///
/// Why not extract these into one mega-protocol: each surface here is
/// a different lifecycle concern and the tests already split that way.

protocol RecordingPermissions: AnyObject {
    var allGranted: Bool { get }
    var needsSetup: Bool { get }
    /// True when Screen Recording (SCK) has been granted. Read by
    /// TeamsMeetingWatcher to skip SCShareableContent calls when the user has
    /// not granted the permission; see docs/07-teams-meeting-detector.md.
    var screenCaptureGranted: Bool { get }
    func checkAll() async
}

extension PermissionManager: RecordingPermissions {}

/// Full UI + action surface for `AudioCaptureManager`. The SwiftUI
/// menus poke at `availableDevices` / `selectedDeviceID` /
/// `refreshDevices()` directly; if you narrow this protocol you also
/// have to refactor the menu wiring, so keep it broad.
protocol AudioCapturing: AnyObject {
    var availableDevices: [AudioInputDevice] { get }
    var selectedDeviceID: String? { get set }

    /// Snapshot of the most recent `stopCapture()`. `nil` before the
    /// first stop or when the manager has never captured. Consumed by
    /// `RecordingManager.stopRecording()` for non-fatal diagnostics
    /// (e.g. mic-silence warning). Never used to drive control flow —
    /// stop success is still governed by `stopCapture()` throwing.
    var lastCaptureDiagnostics: CaptureDiagnostics? { get }

    var onMixedSamples: (([Float]) -> Void)? { get set }
    var onRawSystemBuffer: ((CMSampleBuffer) -> Void)? { get set }
    var onRawMicBuffer: ((CMSampleBuffer) -> Void)? { get set }
    var onStreamError: ((Error) -> Void)? { get set }

    func refreshDevices()
    func startCapture() async throws
    func stopCapture() async throws
}

extension AudioCaptureManager: AudioCapturing {}

/// Encoder surface RecordingManager uses. `setup` always takes an
/// explicit mode so the recording path is observable (legacy vs dual).
/// `finalize()` throws so writer / FIFO-flush failures surface as
/// `EncoderError.writerFailed` rather than silently completing with a
/// partial file.
protocol AudioEncoding: AnyObject {
    var lastError: Error? { get }
    func setup(outputURL: URL, mode: AudioEncoder.EncoderMode) throws
    @discardableResult func enqueue(_ buffer: CMSampleBuffer, source: AudioEncoder.Source) throws -> Bool
    @discardableResult func encodeSamples(_ samples: [Float]) -> Bool
    func finalize() async throws
}

extension AudioEncoder: AudioEncoding {}
