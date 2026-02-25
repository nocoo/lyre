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
    /// Custom output directory for recordings. None = use default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
    /// Persisted input device name. None = follow system default ("Auto").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_device: Option<String>,
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
    let mut config = load_config().unwrap_or_default();
    config.server_url = server_url.to_string();
    config.token = token.to_string();
    write_config(&config)
}

/// Save the output directory to config. Pass None to reset to default.
pub fn save_output_dir(output_dir: Option<&str>) -> Result<(), String> {
    let mut config = load_config().unwrap_or_default();
    config.output_dir = output_dir.map(|s| s.to_string());
    write_config(&config)
}

/// Get the configured output directory, falling back to the default.
pub fn get_output_dir() -> std::path::PathBuf {
    match load_config() {
        Ok(c) => match c.output_dir {
            Some(dir) if !dir.is_empty() => std::path::PathBuf::from(dir),
            _ => crate::recordings::default_output_dir(),
        },
        Err(_) => crate::recordings::default_output_dir(),
    }
}

/// Save the selected input device name. Pass None for "Auto" (system default).
pub fn save_input_device(device_name: Option<&str>) -> Result<(), String> {
    let mut config = load_config().unwrap_or_default();
    config.input_device = device_name.map(|s| s.to_string());
    write_config(&config)
}

/// Get the persisted input device name. None means "Auto" (system default).
pub fn get_input_device() -> Option<String> {
    load_config()
        .ok()
        .and_then(|c| c.input_device)
        .filter(|s| !s.is_empty())
}

/// Write the full config to disk.
fn write_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config directory: {e}"))?;
    }
    let content = serde_json::to_string_pretty(config)
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
            assert!(config.output_dir.is_none());
            assert!(config.input_device.is_none());
            assert!(!has_config());

            // Save server config
            save_config("https://lyre.example.com", "lyre_abc123").unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.server_url, "https://lyre.example.com");
            assert_eq!(config.token, "lyre_abc123");
            assert!(config.output_dir.is_none());
            assert!(has_config());

            // Set custom output dir — should not clobber server config
            save_output_dir(Some("/tmp/my-recordings")).unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.server_url, "https://lyre.example.com");
            assert_eq!(config.output_dir, Some("/tmp/my-recordings".to_string()));
            let dir = get_output_dir();
            assert_eq!(dir, std::path::PathBuf::from("/tmp/my-recordings"));

            // Overwrite server config — output_dir should survive
            save_config("https://lyre.dev.hexly.ai", "lyre_xyz").unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.server_url, "https://lyre.dev.hexly.ai");
            assert_eq!(config.token, "lyre_xyz");
            assert_eq!(config.output_dir, Some("/tmp/my-recordings".to_string()));

            // Reset output dir to default
            save_output_dir(None).unwrap();
            let dir = get_output_dir();
            assert!(dir.to_string_lossy().contains("Lyre Recordings"));

            // --- Input device persistence ---
            // Initially no input device
            assert!(get_input_device().is_none());

            // Save a device name
            save_input_device(Some("USB Mic")).unwrap();
            assert_eq!(get_input_device(), Some("USB Mic".to_string()));

            // Server config should not clobber input_device
            save_config("https://lyre.example.com", "tok").unwrap();
            assert_eq!(get_input_device(), Some("USB Mic".to_string()));

            // Reset to auto
            save_input_device(None).unwrap();
            assert!(get_input_device().is_none());

            // Empty string should also be treated as None
            save_input_device(Some("")).unwrap();
            assert!(get_input_device().is_none());

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
            output_dir: Some("/custom/path".to_string()),
            input_device: Some("USB Mic".to_string()),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("server_url"));
        assert!(json.contains("token"));
        assert!(json.contains("output_dir"));
        assert!(json.contains("input_device"));
        assert!(json.contains("USB Mic"));

        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.server_url, config.server_url);
        assert_eq!(parsed.token, config.token);
        assert_eq!(parsed.output_dir, config.output_dir);
        assert_eq!(parsed.input_device, config.input_device);
    }

    #[test]
    fn test_app_config_backward_compat() {
        // Old config files without output_dir or input_device should still parse
        let json = r#"{"server_url":"https://lyre.example.com","token":"tok"}"#;
        let parsed: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.server_url, "https://lyre.example.com");
        assert!(parsed.output_dir.is_none());
        assert!(parsed.input_device.is_none());
    }
}
