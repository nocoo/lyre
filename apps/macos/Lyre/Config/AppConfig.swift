import Foundation
import os

/// Persistent configuration stored as JSON in Application Support.
///
/// Stores server connection details and recording preferences.
/// Thread-safe via actor-like manual serialization (all mutations on MainActor).
@Observable
final class AppConfig: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "AppConfig")

    // MARK: - Persisted properties

    /// Lyre web server URL (e.g. "https://lyre.example.com").
    var serverURL: String = "" {
        didSet { scheduleSave() }
    }

    /// Authentication token for the Lyre API.
    var authToken: String = "" {
        didSet { scheduleSave() }
    }

    /// Directory where recordings are saved.
    /// Defaults to ~/Documents/Lyre Recordings/
    var outputDirectory: URL = defaultOutputDirectory() {
        didSet { scheduleSave() }
    }

    /// Persisted microphone input device ID. Nil = system default.
    /// Validated against available devices on each launch — if the saved
    /// device is no longer available, this resets to nil (system default).
    var selectedInputDeviceID: String? {
        didSet { scheduleSave() }
    }

    // MARK: - Derived

    /// Whether the server connection is configured (URL and token both non-empty).
    var isServerConfigured: Bool {
        !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Storage

    private let configURL: URL
    private var saveTask: Task<Void, Never>?

    init(configURL: URL? = nil) {
        self.configURL = configURL ?? Self.defaultConfigURL()
        load()
    }

    // MARK: - Persistence

    /// Load configuration from disk. Falls back to defaults if file doesn't exist.
    func load() {
        guard FileManager.default.fileExists(atPath: configURL.path) else {
            Self.logger.info("No config file found, using defaults")
            return
        }

        do {
            let data = try Data(contentsOf: configURL)
            let stored = try JSONDecoder().decode(StoredConfig.self, from: data)
            serverURL = stored.serverURL ?? ""
            authToken = stored.authToken ?? ""
            if let dirPath = stored.outputDirectory {
                outputDirectory = URL(fileURLWithPath: dirPath, isDirectory: true)
            }
            selectedInputDeviceID = stored.selectedInputDeviceID
            Self.logger.info("Config loaded from \(self.configURL.lastPathComponent)")
        } catch {
            Self.logger.error("Failed to load config: \(error.localizedDescription)")
        }
    }

    /// Save configuration to disk immediately.
    func save() {
        let stored = StoredConfig(
            serverURL: serverURL.isEmpty ? nil : serverURL,
            authToken: authToken.isEmpty ? nil : authToken,
            outputDirectory: outputDirectory.path,
            selectedInputDeviceID: selectedInputDeviceID
        )

        do {
            let dir = configURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

            let data = try JSONEncoder().encode(stored)
            try data.write(to: configURL, options: .atomic)
            Self.logger.info("Config saved")
        } catch {
            Self.logger.error("Failed to save config: \(error.localizedDescription)")
        }
    }

    /// Debounced save — coalesces rapid property changes.
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }

    // MARK: - Defaults

    static func defaultOutputDirectory() -> URL {
        FileManager.default.urls(for: .musicDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lyre Recordings", isDirectory: true)
    }

    static func defaultConfigURL() -> URL {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        return appSupport
            .appendingPathComponent("Lyre", isDirectory: true)
            .appendingPathComponent("config.json")
    }
}

// MARK: - Codable representation

private struct StoredConfig: Codable {
    var serverURL: String?
    var authToken: String?
    var outputDirectory: String?
    var selectedInputDeviceID: String?
}
