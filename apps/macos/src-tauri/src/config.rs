//! Keychain-backed configuration for Lyre.
//!
//! Stores `server_url` and `token` as generic passwords in the macOS Keychain
//! under the service name `com.lyre.recorder`.

use security_framework::passwords::{delete_generic_password, set_generic_password};

/// macOS Keychain error code for "item not found" (ERR_SEC_ITEM_NOT_FOUND = -25300).
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

const SERVICE: &str = "com.lyre.recorder";
const ACCOUNT_SERVER_URL: &str = "server_url";
const ACCOUNT_TOKEN: &str = "token";

/// Configuration retrieved from the Keychain.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    pub token: String,
}

/// Read config from the macOS Keychain.
/// Returns empty strings for values that are not yet stored.
pub fn load_config() -> Result<AppConfig, String> {
    let server_url = get_keychain_value(ACCOUNT_SERVER_URL)?;
    let token = get_keychain_value(ACCOUNT_TOKEN)?;
    Ok(AppConfig {
        server_url: server_url.unwrap_or_default(),
        token: token.unwrap_or_default(),
    })
}

/// Save config to the macOS Keychain.
/// Uses upsert semantics (creates if absent, updates if present).
pub fn save_config(server_url: &str, token: &str) -> Result<(), String> {
    set_keychain_value(ACCOUNT_SERVER_URL, server_url)?;
    set_keychain_value(ACCOUNT_TOKEN, token)?;
    Ok(())
}

/// Returns true if both server_url and token are non-empty in the Keychain.
pub fn has_config() -> bool {
    match load_config() {
        Ok(c) => !c.server_url.is_empty() && !c.token.is_empty(),
        Err(_) => false,
    }
}

/// Delete all stored config from the Keychain.
#[allow(dead_code)]
pub fn clear_config() -> Result<(), String> {
    delete_keychain_value(ACCOUNT_SERVER_URL)?;
    delete_keychain_value(ACCOUNT_TOKEN)?;
    Ok(())
}

// --- Internal helpers ---

fn get_keychain_value(account: &str) -> Result<Option<String>, String> {
    // Use the deprecated-but-simple free function; PasswordOptions is !Send
    // and we may be called from async context. The free function is thread-safe.
    #[allow(deprecated)]
    match security_framework::passwords::get_generic_password(SERVICE, account) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(e) => Err(format!("keychain read error ({account}): {e}")),
    }
}

fn set_keychain_value(account: &str, value: &str) -> Result<(), String> {
    set_generic_password(SERVICE, account, value.as_bytes())
        .map_err(|e| format!("keychain write error ({account}): {e}"))
}

fn delete_keychain_value(account: &str) -> Result<(), String> {
    match delete_generic_password(SERVICE, account) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()), // already gone
        Err(e) => Err(format!("keychain delete error ({account}): {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Keychain tests use a test-specific service name to avoid polluting
    // real app credentials. We test the internal helpers directly.

    const TEST_SERVICE: &str = "com.lyre.recorder.test";
    const TEST_ACCOUNT: &str = "test_value";

    fn set_test(value: &str) -> Result<(), String> {
        set_generic_password(TEST_SERVICE, TEST_ACCOUNT, value.as_bytes())
            .map_err(|e| format!("{e}"))
    }

    fn get_test() -> Result<Option<String>, String> {
        #[allow(deprecated)]
        match security_framework::passwords::get_generic_password(TEST_SERVICE, TEST_ACCOUNT) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(e) => Err(format!("{e}")),
        }
    }

    fn delete_test() -> Result<(), String> {
        match delete_generic_password(TEST_SERVICE, TEST_ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(format!("{e}")),
        }
    }

    #[test]
    fn test_keychain_roundtrip() {
        // Clean up first
        let _ = delete_test();

        // Initially absent
        assert_eq!(get_test().unwrap(), None);

        // Write
        set_test("hello-lyre").unwrap();
        assert_eq!(get_test().unwrap(), Some("hello-lyre".to_string()));

        // Upsert (overwrite)
        set_test("updated-value").unwrap();
        assert_eq!(get_test().unwrap(), Some("updated-value".to_string()));

        // Delete
        delete_test().unwrap();
        assert_eq!(get_test().unwrap(), None);

        // Double delete is OK
        delete_test().unwrap();
    }

    #[test]
    fn test_app_config_serialization() {
        let config = AppConfig {
            server_url: "https://lyre.example.com".to_string(),
            token: "lyre_abc123".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("server_url"));
        assert!(json.contains("token"));

        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.server_url, config.server_url);
        assert_eq!(parsed.token, config.token);
    }
}
