import Foundation
import os
import Security

/// Minimal Keychain wrapper for storing string values securely.
///
/// Uses `kSecClassGenericPassword` with the app's bundle ID as `kSecAttrService`.
/// Items are scoped to this app only — no keychain sharing entitlement needed.
enum KeychainHelper {
    private static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "KeychainHelper"
    )

    private static let service = Constants.subsystem

    /// Save a string value to the Keychain under the given account key.
    ///
    /// If an item already exists for this key, it is updated.
    @discardableResult
    static func save(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

        // Try to update first
        let updateAttrs: [String: Any] = [
            kSecValueData as String: data,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, updateAttrs as CFDictionary)

        if updateStatus == errSecSuccess {
            return true
        }

        if updateStatus == errSecItemNotFound {
            // Item doesn't exist yet — add it
            var addQuery = query
            addQuery[kSecValueData as String] = data
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus != errSecSuccess {
                logger.error("Keychain add failed for '\(key)': \(addStatus)")
                return false
            }
            return true
        }

        logger.error("Keychain update failed for '\(key)': \(updateStatus)")
        return false
    }

    /// Read a string value from the Keychain for the given account key.
    ///
    /// Returns `nil` if no item exists or if the data cannot be decoded.
    static func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            if status != errSecItemNotFound {
                logger.error("Keychain read failed for '\(key)': \(status)")
            }
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    /// Delete a Keychain item for the given account key.
    ///
    /// Returns `true` if deleted or if the item didn't exist.
    @discardableResult
    static func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            logger.error("Keychain delete failed for '\(key)': \(status)")
            return false
        }
        return true
    }

    /// Delete all Keychain items stored under a legacy service identifier.
    static func deleteLegacyService(_ legacyService: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: legacyService,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
