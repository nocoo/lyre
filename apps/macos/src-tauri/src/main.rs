mod audio;
mod config;
mod http_client;
mod recorder;
mod tray;

use tauri::Manager;

/// Tauri command: load config from Keychain.
#[tauri::command]
fn get_config() -> Result<config::AppConfig, String> {
    config::load_config()
}

/// Tauri command: save config to Keychain.
#[tauri::command]
fn save_config(server_url: String, token: String) -> Result<(), String> {
    config::save_config(&server_url, &token)
}

/// Tauri command: test connection to the Lyre web server.
/// Runs async via Tauri's built-in tokio runtime.
#[tauri::command]
async fn test_connection() -> Result<(), String> {
    let cfg = config::load_config()?;
    if cfg.server_url.is_empty() || cfg.token.is_empty() {
        return Err("server URL and token must be configured first".to_string());
    }
    http_client::test_connection(&cfg.server_url, &cfg.token).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            test_connection,
        ])
        .setup(|app| {
            tray::setup_tray(app)?;

            // Hide window on close instead of quitting (keeps tray app alive).
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // Auto-open settings window if no config is saved (first run).
            if !config::has_config() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Lyre Recorder");
}
