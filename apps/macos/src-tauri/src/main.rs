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
/// Accepts the current form values so users can test before saving.
#[tauri::command]
async fn test_connection(server_url: String, token: String) -> Result<(), String> {
    if server_url.trim().is_empty() || token.trim().is_empty() {
        return Err("server URL and token must be configured first".to_string());
    }
    http_client::test_connection(&server_url, &token).await
}

/// Tauri command: get the current output directory path.
#[tauri::command]
fn get_output_dir() -> String {
    config::get_output_dir().to_string_lossy().into_owned()
}

/// Tauri command: set a custom output directory. Pass empty string to reset to default.
#[tauri::command]
fn set_output_dir(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        config::save_output_dir(None)
    } else {
        // Validate the directory exists or can be created
        let dir = std::path::PathBuf::from(&path);
        if !dir.exists() {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("failed to create directory: {e}"))?;
        }
        config::save_output_dir(Some(&path))
    }
}

/// Tauri command: open a folder picker dialog and set the output directory.
/// Returns the selected path, or None if the user cancelled.
#[tauri::command]
async fn pick_output_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    let selected = rx.recv().map_err(|e| format!("dialog error: {e}"))?;
    match selected {
        Some(path) => {
            if let Some(path_buf) = path.as_path() {
                let path_str = path_buf.to_string_lossy().into_owned();
                config::save_output_dir(Some(&path_str))?;
                Ok(Some(path_str))
            } else {
                Err("invalid path selected".to_string())
            }
        }
        None => Ok(None), // User cancelled
    }
}

/// Tauri command: open the output directory in Finder.
#[tauri::command]
fn open_output_dir() -> Result<(), String> {
    let dir = config::get_output_dir();
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("failed to open directory: {e}"))?;
    Ok(())
}

/// Tauri command: list local recordings from the output directory.
#[tauri::command]
fn list_recordings() -> Result<Vec<recordings::RecordingInfo>, String> {
    let output_dir = config::get_output_dir();
    recordings::list_recordings(&output_dir)
}

/// Tauri command: delete a local recording file.
#[tauri::command]
fn delete_recording(file_path: String) -> Result<(), String> {
    let output_dir = config::get_output_dir();
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

/// Tauri command: preview which recordings match a cleanup filter.
/// Returns the list of recordings that would be deleted without actually deleting them.
#[tauri::command]
fn preview_cleanup(
    filter: recordings::CleanupFilter,
) -> Result<Vec<recordings::RecordingInfo>, String> {
    let output_dir = config::get_output_dir();
    let all = recordings::list_recordings(&output_dir)?;
    Ok(recordings::find_cleanable_recordings(&all, &filter))
}

/// Tauri command: batch delete recordings by file paths.
#[tauri::command]
fn batch_delete_recordings(
    file_paths: Vec<String>,
) -> Result<recordings::CleanupResult, String> {
    let output_dir = config::get_output_dir();
    Ok(recordings::batch_delete_recordings(&file_paths, &output_dir))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            test_connection,
            get_output_dir,
            set_output_dir,
            pick_output_dir,
            open_output_dir,
            list_recordings,
            delete_recording,
            reveal_recording,
            upload_recording,
            preview_cleanup,
            batch_delete_recordings,
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
        .expect("failed to run Lyre");
}
