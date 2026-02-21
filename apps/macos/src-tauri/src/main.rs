mod audio;
mod config;
mod http_client;
mod recorder;
mod recordings;
mod tray;
mod upload;

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
#[tauri::command]
async fn test_connection() -> Result<(), String> {
    let cfg = config::load_config()?;
    if cfg.server_url.is_empty() || cfg.token.is_empty() {
        return Err("server URL and token must be configured first".to_string());
    }
    http_client::test_connection(&cfg.server_url, &cfg.token).await
}

/// Tauri command: list local recordings from the output directory.
#[tauri::command]
fn list_recordings() -> Result<Vec<recordings::RecordingInfo>, String> {
    let output_dir = recordings::default_output_dir();
    recordings::list_recordings(&output_dir)
}

/// Tauri command: delete a local recording file.
#[tauri::command]
fn delete_recording(file_path: String) -> Result<(), String> {
    let output_dir = recordings::default_output_dir();
    recordings::delete_recording(&file_path, &output_dir)
}

/// Tauri command: reveal a recording in Finder.
#[tauri::command]
fn reveal_recording(file_path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &file_path])
        .spawn()
        .map_err(|e| format!("failed to reveal in Finder: {e}"))?;
    Ok(())
}

/// Tauri command: upload a local recording to the Lyre web app.
#[tauri::command]
async fn upload_recording(file_path: String) -> Result<upload::UploadResult, String> {
    upload::upload_recording(&file_path).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            test_connection,
            list_recordings,
            delete_recording,
            reveal_recording,
            upload_recording,
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
