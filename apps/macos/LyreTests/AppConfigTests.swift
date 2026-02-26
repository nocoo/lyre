import Testing
import Foundation
@testable import Lyre

@Suite("AppConfig Tests")
struct AppConfigTests {

    /// Create a config with a temporary file path for isolated testing.
    private func makeConfig() -> (AppConfig, URL) {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let config = AppConfig(configURL: configURL)
        return (config, tempDir)
    }

    private func cleanup(_ dir: URL) {
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: - Defaults

    @Test func defaultValues() {
        let (config, dir) = makeConfig()
        defer { cleanup(dir) }

        #expect(config.serverURL == "")
        #expect(config.authToken == "")
        #expect(config.outputDirectory == AppConfig.defaultOutputDirectory())
        #expect(config.selectedInputDeviceID == nil)
        #expect(!config.isServerConfigured)
    }

    // MARK: - isServerConfigured

    @Test func isServerConfiguredRequiresBothFields() {
        let (config, dir) = makeConfig()
        defer { cleanup(dir) }

        config.serverURL = "https://example.com"
        #expect(!config.isServerConfigured)

        config.authToken = "tok_123"
        #expect(config.isServerConfigured)

        config.serverURL = "  "
        #expect(!config.isServerConfigured)
    }

    // MARK: - Persistence round-trip

    @Test func saveAndLoadRoundTrip() {
        let (config, dir) = makeConfig()
        defer { cleanup(dir) }

        let configURL = dir.appendingPathComponent("config.json")

        config.serverURL = "https://lyre.test"
        config.authToken = "secret-token"
        let customDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("custom-recordings", isDirectory: true)
        config.outputDirectory = customDir
        config.save()

        // Load into a fresh instance
        let loaded = AppConfig(configURL: configURL)
        #expect(loaded.serverURL == "https://lyre.test")
        #expect(loaded.authToken == "secret-token")
        #expect(loaded.outputDirectory == customDir)
    }

    // MARK: - Missing config file

    @Test func loadMissingFileUsesDefaults() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lyre-test-\(UUID().uuidString)", isDirectory: true)
        let configURL = tempDir.appendingPathComponent("nonexistent.json")
        let config = AppConfig(configURL: configURL)

        #expect(config.serverURL == "")
        #expect(config.authToken == "")
    }

    // MARK: - Corrupt config file

    @Test func loadCorruptFileUsesDefaults() {
        let (_, dir) = makeConfig()
        defer { cleanup(dir) }

        let configURL = dir.appendingPathComponent("config.json")
        try! "not json".data(using: .utf8)!.write(to: configURL)

        let config = AppConfig(configURL: configURL)
        #expect(config.serverURL == "")
        #expect(config.authToken == "")
    }

    // MARK: - Empty values not persisted

    @Test func emptyValuesStoredAsNull() {
        let (config, dir) = makeConfig()
        defer { cleanup(dir) }

        let configURL = dir.appendingPathComponent("config.json")
        config.save()

        let data = try! Data(contentsOf: configURL)
        let json = try! JSONDecoder().decode([String: String?].self, from: data)

        // serverURL and authToken should be null (not stored) when empty
        #expect(json["serverURL"] == nil)
        #expect(json["authToken"] == nil)
        // outputDirectory should always be stored
        #expect(json["outputDirectory"] != nil)
        // selectedInputDeviceID should be null when nil
        #expect(json["selectedInputDeviceID"] == nil)
    }

    // MARK: - Input device persistence

    @Test func selectedInputDeviceIDRoundTrip() {
        let (config, dir) = makeConfig()
        defer { cleanup(dir) }

        let configURL = dir.appendingPathComponent("config.json")

        config.selectedInputDeviceID = "BuiltInMic:12345"
        config.save()

        let loaded = AppConfig(configURL: configURL)
        #expect(loaded.selectedInputDeviceID == "BuiltInMic:12345")
    }

    @Test func selectedInputDeviceIDNilRoundTrip() {
        let (config, dir) = makeConfig()
        defer { cleanup(dir) }

        let configURL = dir.appendingPathComponent("config.json")

        config.selectedInputDeviceID = nil
        config.save()

        let loaded = AppConfig(configURL: configURL)
        #expect(loaded.selectedInputDeviceID == nil)
    }
}
