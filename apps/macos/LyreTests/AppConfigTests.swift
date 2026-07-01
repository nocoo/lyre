import Testing
import Foundation
@testable import Lyre

@Suite("AppConfig Tests")
struct AppConfigTests {

    /// Isolated test context with temporary file path.
    private struct TestContext {
        let config: AppConfig
        let dir: URL

        var configURL: URL { dir.appendingPathComponent("config.json") }

        func cleanup() {
            try? FileManager.default.removeItem(at: dir)
        }
    }

    /// Create a config with a temporary file path for isolated testing.
    private func makeContext(suffix: String = UUID().uuidString) -> TestContext {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(suffix)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let config = AppConfig(configURL: configURL)
        return TestContext(config: config, dir: tempDir)
    }

    // MARK: - Defaults

    @Test func defaultValues() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        #expect(ctx.config.serverURL == AppConfig.defaultServerURL)
        #expect(ctx.config.authToken == "")
        #expect(ctx.config.outputDirectory == AppConfig.defaultOutputDirectory())
        #expect(ctx.config.selectedInputDeviceID == nil)
        #expect(!ctx.config.isServerConfigured)
    }

    @Test func defaultServerURLIsHexly() {
        #expect(AppConfig.defaultServerURL == "https://lyre.hexly.ai")
    }

    // MARK: - isServerConfigured

    @Test func isServerConfiguredRequiresBothFields() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        // Default serverURL is set, but token is empty
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

        // Load into a fresh instance
        let loaded = AppConfig(configURL: ctx.configURL)
        #expect(loaded.serverURL == "https://lyre.test")
        #expect(loaded.authToken == "secret-token")
        #expect(loaded.outputDirectory == customDir)
    }

    // MARK: - Auth token persisted in JSON

    @Test func authTokenStoredInJSON() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.serverURL = "https://lyre.test"
        ctx.config.authToken = "secret-token"
        ctx.config.save()

        // Read the raw JSON and verify authToken is present
        guard let data = try? Data(contentsOf: ctx.configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            Issue.record("Failed to read/parse config JSON")
            return
        }

        #expect(json["authToken"] as? String == "secret-token")
    }

    // MARK: - Missing config file

    @Test func loadMissingFileUsesDefaults() {
        let suffix = UUID().uuidString
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(suffix)", isDirectory: true)
        let configURL = tempDir.appendingPathComponent("nonexistent.json")
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let config = AppConfig(configURL: configURL)
        #expect(config.serverURL == AppConfig.defaultServerURL)
        #expect(config.authToken == "")
    }

    // MARK: - Corrupt config file

    @Test func loadCorruptFileUsesDefaults() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        try? Data("not json".utf8).write(to: ctx.configURL)

        let config = AppConfig(configURL: ctx.configURL)
        #expect(config.serverURL == AppConfig.defaultServerURL)
        #expect(config.authToken == "")
    }

    // MARK: - Empty values not persisted

    @Test func emptyValuesStoredAsNull() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        // Force serverURL to empty (overrides default) so we can verify the
        // "empty string → null in JSON" contract independent of the default.
        ctx.config.serverURL = ""
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
        // authToken should be null when empty (never set in this test)
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

        let loaded = AppConfig(configURL: ctx.configURL)
        #expect(loaded.selectedInputDeviceID == "BuiltInMic:12345")
    }

    @Test func selectedInputDeviceIDNilRoundTrip() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.selectedInputDeviceID = nil
        ctx.config.save()

        let loaded = AppConfig(configURL: ctx.configURL)
        #expect(loaded.selectedInputDeviceID == nil)
    }

    // MARK: - Auth token clearing

    @Test func clearingAuthTokenPersistsAsNull() {
        let ctx = makeContext()
        defer { ctx.cleanup() }

        ctx.config.authToken = "some-token"
        ctx.config.save()

        ctx.config.authToken = ""
        ctx.config.save()

        let loaded = AppConfig(configURL: ctx.configURL)
        #expect(loaded.authToken == "")
    }
}
