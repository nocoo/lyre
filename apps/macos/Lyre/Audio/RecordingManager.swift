import AVFoundation
import os

/// Manages the full recording lifecycle: permissions → capture → encode → M4A file.
///
/// State machine:
/// - `.idle` → ready to record
/// - `.recording` → actively capturing and encoding audio
///
/// Uses `AudioCaptureManager` for SCK capture and `AudioEncoder` for M4A/AAC encoding.
@Observable
final class RecordingManager: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "RecordingManager")

    enum State: Equatable, Sendable {
        case idle
        case recording
    }

    enum RecordingError: LocalizedError, Equatable {
        case alreadyRecording
        case notRecording
        case permissionDenied
        case encoderSetupFailed(String)

        var errorDescription: String? {
            switch self {
            case .alreadyRecording:
                return "A recording is already in progress"
            case .notRecording:
                return "No recording is in progress"
            case .permissionDenied:
                return "Required permissions have not been granted"
            case .encoderSetupFailed(let detail):
                return "Failed to set up audio encoder: \(detail)"
            }
        }
    }

    // MARK: - Observable state

    internal(set) var state: State = .idle
    internal(set) var currentFileURL: URL?
    internal(set) var recordingStartTime: Date?

    /// Elapsed seconds since recording started. Updated externally by a timer or UI poll.
    var elapsedSeconds: TimeInterval {
        guard let start = recordingStartTime else { return 0 }
        return Date().timeIntervalSince(start)
    }

    /// Last error that occurred during recording.
    internal(set) var lastError: Error?

    // MARK: - Dependencies

    let permissions: PermissionManager
    let capture: AudioCaptureManager

    /// Directory where recordings are saved.
    var outputDirectory: URL

    // MARK: - Private encoder

    private var encoder: AudioEncoder?

    // MARK: - Init

    init(
        permissions: PermissionManager = PermissionManager(),
        capture: AudioCaptureManager = AudioCaptureManager(),
        outputDirectory: URL? = nil
    ) {
        self.permissions = permissions
        self.capture = capture
        self.outputDirectory = outputDirectory ?? Self.defaultOutputDirectory()
    }

    // MARK: - Recording Control

    /// Start recording system audio + microphone to an M4A file.
    ///
    /// - Throws: `RecordingError` if already recording, permissions missing, or encoder fails.
    func startRecording() async throws {
        guard state == .idle else {
            throw RecordingError.alreadyRecording
        }

        // Verify permissions
        await permissions.checkAll()
        guard permissions.allGranted else {
            throw RecordingError.permissionDenied
        }

        lastError = nil

        // Prepare output file
        try ensureOutputDirectory()
        let fileURL = generateOutputURL()

        // Set up encoder
        let enc = AudioEncoder()
        do {
            try enc.setup(outputURL: fileURL)
        } catch let error as AudioEncoder.EncoderError {
            throw RecordingError.encoderSetupFailed(error.localizedDescription)
        }
        encoder = enc

        // Wire up capture → encoder pipeline
        capture.onMixedSamples = { [weak self] samples in
            self?.encoder?.encodeSamples(samples)
        }
        capture.onStreamError = { [weak self] error in
            self?.handleStreamError(error)
        }

        // Start capture
        try await capture.startCapture()

        currentFileURL = fileURL
        recordingStartTime = Date()
        state = .recording
    }

    /// Stop the current recording and finalize the M4A file.
    ///
    /// - Returns: URL of the completed M4A file.
    /// - Throws: `RecordingError` if not recording.
    @discardableResult
    func stopRecording() async throws -> URL {
        guard state == .recording else {
            throw RecordingError.notRecording
        }

        // Stop capture (flushes remaining mixer samples via onMixedSamples)
        try await capture.stopCapture()

        // Finalize encoder
        guard let fileURL = currentFileURL else {
            throw RecordingError.notRecording
        }
        await encoder?.finalize()
        encoder = nil

        // Reset state
        state = .idle
        recordingStartTime = nil
        capture.onMixedSamples = nil
        capture.onStreamError = nil

        return fileURL
    }

    // MARK: - Error Handling

    private func handleStreamError(_ error: Error) {
        lastError = error
        Self.logger.error("Stream error: \(error.localizedDescription)")

        // Best-effort recovery: always finalize encoder even if capture
        // stop fails, to avoid corrupting the output file.
        Task {
            // Try to stop capture, but don't let failure prevent finalization
            do {
                try await capture.stopCapture()
            } catch {
                Self.logger.warning(
                    "stopCapture failed during error recovery: \(error.localizedDescription)"
                )
            }

            // Always finalize encoder to close the output file properly
            await encoder?.finalize()
            encoder = nil

            // Reset state
            state = .idle
            recordingStartTime = nil
            capture.onMixedSamples = nil
            capture.onStreamError = nil

            Self.logger.info("Recording stopped after stream error, file may be partial")
        }
    }

    // MARK: - File Management

    /// Default output directory: ~/Documents/Lyre Recordings/
    static func defaultOutputDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lyre Recordings", isDirectory: true)
    }

    /// Ensure the output directory exists.
    private func ensureOutputDirectory() throws {
        try FileManager.default.createDirectory(
            at: outputDirectory,
            withIntermediateDirectories: true
        )
    }

    /// Generate a timestamped output file URL.
    ///
    /// Format: `Recording 2026-02-26 at 10.30.45.m4a`
    func generateOutputURL() -> URL {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let timestamp = formatter.string(from: Date())
        let filename = "Recording \(timestamp).m4a"
        return outputDirectory.appendingPathComponent(filename)
    }
}
