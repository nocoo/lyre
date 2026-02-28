import Foundation
import os

/// Persistent configuration stored as JSON in Application Support.
///
/// Stores server connection details and recording preferences.
/// The auth token is stored securely in the Keychain, not in the JSON file.
/// Thread-safe via actor-like manual serialization (all mutations on MainActor).
@Observable
final class AppConfig: @unchecked Sendable {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "AppConfig")

    /// Keychain account key for the auth token.
    static let authTokenKeychainKey = "authToken"

    // MARK: - Persisted properties

    /// Lyre web server URL (e.g. "https://lyre.example.com").
    var serverURL: String = "" {
        didSet { scheduleSave() }
    }

    /// Authentication token for the Lyre API.
    /// Stored in Keychain, not in the JSON config file.
    var authToken: String = "" {
        didSet { saveAuthToken() }
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

    /// Keychain key used for this instance. Overridable for testing.
    let keychainKey: String

    private var saveTask: Task<Void, Never>?

    init(configURL: URL? = nil, keychainKey: String = authTokenKeychainKey) {
        self.configURL = configURL ?? Self.defaultConfigURL()
        self.keychainKey = keychainKey
        load()
    }

    // MARK: - Persistence

    /// Load configuration from disk + Keychain. Falls back to defaults if missing.
    func load() {
        // Clean up Keychain entries from the old bundle ID (one-time, idempotent)
        KeychainHelper.deleteLegacyService("com.lyre.app")

        // Load auth token from Keychain
        authToken = KeychainHelper.read(key: keychainKey) ?? ""

        guard FileManager.default.fileExists(atPath: configURL.path) else {
            Self.logger.info("No config file found, using defaults")
            return
        }

        do {
            let data = try Data(contentsOf: configURL)
            let stored = try JSONDecoder().decode(StoredConfig.self, from: data)
            serverURL = stored.serverURL ?? ""
            if let dirPath = stored.outputDirectory {
                outputDirectory = URL(fileURLWithPath: dirPath, isDirectory: true)
            }
            selectedInputDeviceID = stored.selectedInputDeviceID

            // Migration: if authToken exists in JSON, move it to Keychain
            if let jsonToken = stored.authToken, !jsonToken.isEmpty {
                Self.logger.info("Migrating auth token from JSON to Keychain")
                authToken = jsonToken
                KeychainHelper.save(key: keychainKey, value: jsonToken)
                // Re-save JSON without the token
                save()
            }

            Self.logger.info("Config loaded from \(self.configURL.lastPathComponent)")
        } catch {
            Self.logger.error("Failed to load config: \(error.localizedDescription)")
        }
    }

    /// Save configuration to disk (JSON only, no auth token).
    func save() {
        let stored = StoredConfig(
            serverURL: serverURL.isEmpty ? nil : serverURL,
            authToken: nil,  // Never store in JSON
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

    /// Save auth token to Keychain immediately.
    private func saveAuthToken() {
        if authToken.isEmpty {
            KeychainHelper.delete(key: keychainKey)
        } else {
            KeychainHelper.save(key: keychainKey, value: authToken)
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

/// JSON structure for on-disk config.
/// `authToken` is kept for backward compatibility (migration reads it, but never writes it).
private struct StoredConfig: Codable {
    var serverURL: String?
    var authToken: String?
    var outputDirectory: String?
    var selectedInputDeviceID: String?
}
