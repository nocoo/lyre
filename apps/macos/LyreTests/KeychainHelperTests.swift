import Foundation
import Testing
@testable import Lyre

@Suite("KeychainHelper Tests")
struct KeychainHelperTests {

    /// Unique key prefix for test isolation. Each test uses its own key
    /// to avoid polluting the real Keychain or interfering with other tests.
    private func testKey(_ suffix: String = "default") -> String {
        "lyre-test-keychain-\(suffix)-\(UUID().uuidString)"
    }

    // MARK: - Save & Read

    @Test func saveAndReadRoundTrip() {
        let key = testKey("roundtrip")
        defer { KeychainHelper.delete(key: key) }

        let saved = KeychainHelper.save(key: key, value: "my-secret-token")
        #expect(saved == true)

        let value = KeychainHelper.read(key: key)
        #expect(value == "my-secret-token")
    }

    @Test func readNonExistentKeyReturnsNil() {
        let key = testKey("nonexistent")
        let value = KeychainHelper.read(key: key)
        #expect(value == nil)
    }

    // MARK: - Update (overwrite)

    @Test func saveOverwritesExistingValue() {
        let key = testKey("overwrite")
        defer { KeychainHelper.delete(key: key) }

        KeychainHelper.save(key: key, value: "old-value")
        KeychainHelper.save(key: key, value: "new-value")

        let value = KeychainHelper.read(key: key)
        #expect(value == "new-value")
    }

    // MARK: - Delete

    @Test func deleteExistingKey() {
        let key = testKey("delete")

        KeychainHelper.save(key: key, value: "to-be-deleted")
        let deleted = KeychainHelper.delete(key: key)
        #expect(deleted == true)

        let value = KeychainHelper.read(key: key)
        #expect(value == nil)
    }

    @Test func deleteNonExistentKeySucceeds() {
        let key = testKey("delete-missing")
        let deleted = KeychainHelper.delete(key: key)
        #expect(deleted == true)
    }

    // MARK: - Edge cases

    @Test func saveEmptyString() {
        let key = testKey("empty")
        defer { KeychainHelper.delete(key: key) }

        KeychainHelper.save(key: key, value: "")
        let value = KeychainHelper.read(key: key)
        #expect(value == "")
    }

    @Test func saveUnicodeValue() {
        let key = testKey("unicode")
        defer { KeychainHelper.delete(key: key) }

        let token = "lyre_日本語テスト🔑"
        KeychainHelper.save(key: key, value: token)
        let value = KeychainHelper.read(key: key)
        #expect(value == token)
    }

    @Test func saveLongValue() {
        let key = testKey("long")
        defer { KeychainHelper.delete(key: key) }

        // Simulate a long base64url token
        let token = "lyre_" + String(repeating: "abcdefghijklmnop", count: 64)
        KeychainHelper.save(key: key, value: token)
        let value = KeychainHelper.read(key: key)
        #expect(value == token)
    }

    @Test func independentKeysDoNotInterfere() {
        let key1 = testKey("independent-1")
        let key2 = testKey("independent-2")
        defer {
            KeychainHelper.delete(key: key1)
            KeychainHelper.delete(key: key2)
        }

        KeychainHelper.save(key: key1, value: "value-1")
        KeychainHelper.save(key: key2, value: "value-2")

        #expect(KeychainHelper.read(key: key1) == "value-1")
        #expect(KeychainHelper.read(key: key2) == "value-2")

        KeychainHelper.delete(key: key1)
        #expect(KeychainHelper.read(key: key1) == nil)
        #expect(KeychainHelper.read(key: key2) == "value-2")
    }
}
