//! File-backed configuration for Lyre.
//!
//! Stores `server_url` and `token` as a JSON file in the app's data directory
//! (`~/Library/Application Support/com.lyre.app/config.json`).

use std::fs;
use std::path::PathBuf;

const APP_DIR_NAME: &str = "com.lyre.app";
const CONFIG_FILE: &str = "config.json";

/// Configuration for the Lyre app.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    pub token: String,
}

/// Returns the path to the config file.
fn config_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("could not determine app data directory")?;
    Ok(data_dir.join(APP_DIR_NAME).join(CONFIG_FILE))
}

/// Read config from the JSON file.
/// Returns default (empty) config if the file does not exist.
pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("failed to read config: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("failed to parse config: {e}"))
}

/// Save config to the JSON file.
/// Creates the directory if it doesn't exist.
pub fn save_config(server_url: &str, token: &str) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config directory: {e}"))?;
    }
    let config = AppConfig {
        server_url: server_url.to_string(),
        token: token.to_string(),
    };
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("failed to write config: {e}"))
}

/// Returns true if both server_url and token are non-empty.
pub fn has_config() -> bool {
    match load_config() {
        Ok(c) => !c.server_url.is_empty() && !c.token.is_empty(),
        Err(_) => false,
    }
}

/// Delete the config file.
#[allow(dead_code)]
pub fn clear_config() -> Result<(), String> {
    let path = config_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("failed to delete config: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    /// Set up a temp directory as the data dir for isolated tests.
    fn with_temp_config<F: FnOnce()>(f: F) {
        let tmp = tempfile::tempdir().unwrap();
        let original = env::var("HOME").ok();
        // dirs::data_dir() on macOS uses $HOME/Library/Application Support
        env::set_var("HOME", tmp.path());
        f();
        // Restore
        if let Some(home) = original {
            env::set_var("HOME", home);
        }
    }

    #[test]
    fn test_config_roundtrip() {
        with_temp_config(|| {
            // Initially empty
            let config = load_config().unwrap();
            assert!(config.server_url.is_empty());
            assert!(config.token.is_empty());
            assert!(!has_config());

            // Save
            save_config("https://lyre.example.com", "lyre_abc123").unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.server_url, "https://lyre.example.com");
            assert_eq!(config.token, "lyre_abc123");
            assert!(has_config());

            // Overwrite
            save_config("https://lyre.dev.hexly.ai", "lyre_xyz").unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.server_url, "https://lyre.dev.hexly.ai");
            assert_eq!(config.token, "lyre_xyz");

            // Clear
            clear_config().unwrap();
            let config = load_config().unwrap();
            assert!(config.server_url.is_empty());
            assert!(!has_config());
        });
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
