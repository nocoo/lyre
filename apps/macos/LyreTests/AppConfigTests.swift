import Testing
import Foundation
@testable import Lyre

@Suite("AppConfig Tests")
struct AppConfigTests {

    /// Isolated test context with temporary file path and unique Keychain key.
    private struct TestContext {
        let config: AppConfig
        let dir: URL
        let keychainKey: String

        var configURL: URL { dir.appendingPathComponent("config.json") }

        func cleanup() {
            try? FileManager.default.removeItem(at: dir)
            KeychainHelper.delete(key: keychainKey)
        }
    }

    /// Create a config with a temporary file path and unique Keychain key for isolated testing.
    private func makeContext(suffix: String = UUID().uuidString) -> TestContext {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(suffix)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let keychainKey = "lyre-test-auth-\(suffix)"
        let config = AppConfig(configURL: configURL, keychainKey: keychainKey)
        return TestContext(config: config, dir: tempDir, keychainKey: keychainKey)
    }

    // MARK: - Defaults

    @Test func defaultValues() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        #expect(ctx.config.serverURL == "")
        #expect(ctx.config.authToken == "")
        #expect(ctx.config.outputDirectory == AppConfig.defaultOutputDirectory())
        #expect(ctx.config.selectedInputDeviceID == nil)
        #expect(!ctx.config.isServerConfigured)
    }

    // MARK: - isServerConfigured

    @Test func isServerConfiguredRequiresBothFields() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.serverURL = "https://example.com"
        #expect(!ctx.config.isServerConfigured)

        ctx.config.authToken = "tok_123"
        #expect(ctx.config.isServerConfigured)

        ctx.config.serverURL = "  "
        #expect(!ctx.config.isServerConfigured)
    }

    // MARK: - Persistence round-trip

    @Test func saveAndLoadRoundTrip() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.serverURL = "https://lyre.test"
        ctx.config.authToken = "secret-token"
        let customDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("custom-recordings", isDirectory: true)
        ctx.config.outputDirectory = customDir
        ctx.config.save()

        // Load into a fresh instance with the same Keychain key
        let loaded = AppConfig(configURL: ctx.configURL, keychainKey: ctx.keychainKey)
        #expect(loaded.serverURL == "https://lyre.test")
        #expect(loaded.authToken == "secret-token")
        #expect(loaded.outputDirectory == customDir)
    }

    // MARK: - Auth token stored in Keychain, not JSON

    @Test func authTokenNotInJSON() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.serverURL = "https://lyre.test"
        ctx.config.authToken = "secret-token"
        ctx.config.save()

        // Read the raw JSON and verify authToken is nil
        guard let data = try? Data(contentsOf: ctx.configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            Issue.record("Failed to read/parse config JSON")
            return
        }

        // authToken must not be in the JSON file
        let jsonToken = json["authToken"]
        #expect(jsonToken == nil || jsonToken is NSNull)

        // But it should be readable from Keychain
        let keychainToken = KeychainHelper.read(key: ctx.keychainKey)
        #expect(keychainToken == "secret-token")
    }

    // MARK: - Migration from old JSON format

    @Test func migratesAuthTokenFromJSONToKeychain() {
        let suffix = UUID().uuidString
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(suffix)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let keychainKey = "lyre-test-auth-\(suffix)"
        defer {
            try? FileManager.default.removeItem(at: tempDir)
            KeychainHelper.delete(key: keychainKey)
        }

        // Write an old-format JSON with authToken embedded
        let oldJSON: [String: String] = [
            "serverURL": "https://old.test",
            "authToken": "legacy-token-123",
            "outputDirectory": "/tmp/recordings",
        ]
        guard let data = try? JSONEncoder().encode(oldJSON) else {
            Issue.record("Failed to encode old JSON")
            return
        }
        try? data.write(to: configURL)

        // Loading should migrate the token to Keychain
        let config = AppConfig(configURL: configURL, keychainKey: keychainKey)
        #expect(config.authToken == "legacy-token-123")
        #expect(config.serverURL == "https://old.test")

        // Verify token is now in Keychain
        #expect(KeychainHelper.read(key: keychainKey) == "legacy-token-123")

        // Verify JSON no longer contains the token (migration re-saved)
        guard let updatedData = try? Data(contentsOf: configURL),
              let updatedJSON = try? JSONSerialization.jsonObject(with: updatedData) as? [String: Any]
        else {
            Issue.record("Failed to read migrated JSON")
            return
        }
        let tokenInJSON = updatedJSON["authToken"]
        #expect(tokenInJSON == nil || tokenInJSON is NSNull)
    }

    // MARK: - Missing config file

    @Test func loadMissingFileUsesDefaults() {
        let suffix = UUID().uuidString
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(suffix)", isDirectory: true)
        let configURL = tempDir.appendingPathComponent("nonexistent.json")
        let keychainKey = "lyre-test-auth-\(suffix)"
        defer { KeychainHelper.delete(key: keychainKey) }

        let config = AppConfig(configURL: configURL, keychainKey: keychainKey)
        #expect(config.serverURL == "")
        #expect(config.authToken == "")
    }

    // MARK: - Corrupt config file

    @Test func loadCorruptFileUsesDefaults() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        try? Data("not json".utf8).write(to: ctx.configURL)

        let config = AppConfig(configURL: ctx.configURL, keychainKey: ctx.keychainKey)
        #expect(config.serverURL == "")
        #expect(config.authToken == "")
    }

    // MARK: - Empty values not persisted

    @Test func emptyValuesStoredAsNull() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.save()

        guard let data = try? Data(contentsOf: ctx.configURL) else {
            Issue.record("Failed to read config file")
            return
        }
        guard let json = try? JSONDecoder().decode([String: String?].self, from: data) else {
            Issue.record("Failed to decode config JSON")
            return
        }

        // serverURL should be null when empty
        #expect(json["serverURL"] == nil)
        // authToken should never be in JSON
        #expect(json["authToken"] == nil)
        // outputDirectory should always be stored
        #expect(json["outputDirectory"] != nil)
        // selectedInputDeviceID should be null when nil
        #expect(json["selectedInputDeviceID"] == nil)
    }

    // MARK: - Input device persistence

    @Test func selectedInputDeviceIDRoundTrip() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.selectedInputDeviceID = "BuiltInMic:12345"
        ctx.config.save()

        let loaded = AppConfig(configURL: ctx.configURL, keychainKey: ctx.keychainKey)
        #expect(loaded.selectedInputDeviceID == "BuiltInMic:12345")
    }

    @Test func selectedInputDeviceIDNilRoundTrip() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.selectedInputDeviceID = nil
        ctx.config.save()

        let loaded = AppConfig(configURL: ctx.configURL, keychainKey: ctx.keychainKey)
        #expect(loaded.selectedInputDeviceID == nil)
    }

    // MARK: - Auth token clearing

    @Test func clearingAuthTokenDeletesFromKeychain() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.authToken = "some-token"
        #expect(KeychainHelper.read(key: ctx.keychainKey) == "some-token")

        ctx.config.authToken = ""
        #expect(KeychainHelper.read(key: ctx.keychainKey) == nil)
    }
}
