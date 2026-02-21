use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Wry};

use crate::audio::AudioDeviceManager;
use crate::recorder::{Recorder, RecorderConfig, RecorderState};

// Tray icons embedded at compile time (22x22 PNG).
const TRAY_ICON_IDLE: &[u8] = include_bytes!("../icons/tray-icon.png");
const TRAY_ICON_RECORDING: &[u8] = include_bytes!("../icons/tray-icon-recording.png");

/// Shared state that is Send+Sync safe.
/// The Recorder itself holds the cpal::Stream which is !Send, so we wrap it
/// in a way that sends commands to the main thread. However, on macOS the
/// tray event handler runs on the main thread anyway, so we can use a Mutex
/// with unsafe Send/Sync wrapper for the !Send stream.
struct SendableState {
    recorder: Recorder,
    device_manager: AudioDeviceManager,
}

// Safety: On macOS, Tauri menu events are dispatched on the main thread.
// The cpal::Stream inside Recorder is only accessed from menu event handlers,
// which all run on the same (main) thread. We never actually send the state
// across threads.
unsafe impl Send for SendableState {}
unsafe impl Sync for SendableState {}

/// Set up the system tray with menus. Called once during app setup.
pub fn setup_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(Mutex::new(SendableState {
        recorder: Recorder::new(RecorderConfig::default()),
        device_manager: AudioDeviceManager::new(),
    }));

    let tray_menu = {
        let s = state.lock().unwrap();
        build_tray_menu(app, &s)?
    };

    let state_for_event = state.clone();

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(Image::from_bytes(TRAY_ICON_IDLE)?)
        .icon_as_template(true)
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .tooltip("Lyre Recorder")
        .on_menu_event(move |app, event| {
            handle_menu_event(app, &event.id().0, &state_for_event);
        })
        .build(app)?;

    Ok(())
}

fn build_tray_menu(
    app: &App,
    state: &SendableState,
) -> Result<Menu<Wry>, Box<dyn std::error::Error>> {
    let is_recording = state.recorder.state() == RecorderState::Recording;

    // Toggle recording
    let toggle_label = if is_recording {
        "Stop Recording"
    } else {
        "Start Recording"
    };
    let toggle_item = MenuItem::with_id(app, "toggle_recording", toggle_label, true, None::<&str>)?;

    // Device submenu
    let device_submenu = build_device_submenu(app, state)?;

    // Output folder display
    let output_dir_display = state
        .recorder
        .config
        .output_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    let output_item = MenuItem::with_id(
        app,
        "set_output_dir",
        format!("Output: {output_dir_display}..."),
        !is_recording,
        None::<&str>,
    )?;

    // Open output folder
    let open_folder = MenuItem::with_id(
        app,
        "open_output_dir",
        "Open Output Folder",
        true,
        None::<&str>,
    )?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let quit = MenuItem::with_id(app, "quit", "Quit Lyre Recorder", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &sep1,
            &device_submenu,
            &output_item,
            &open_folder,
            &sep2,
            &quit,
        ],
    )?;

    Ok(menu)
}

fn build_device_submenu(
    app: &App,
    state: &SendableState,
) -> Result<Submenu<Wry>, Box<dyn std::error::Error>> {
    let devices = state.device_manager.list_input_devices();
    let selected_idx = state.recorder.config.selected_device_index;

    let mut items: Vec<CheckMenuItem<Wry>> = Vec::new();

    // "Auto (Default)" option
    let auto_checked = selected_idx.is_none();
    let auto_item = CheckMenuItem::with_id(
        app,
        "device_auto",
        "Auto (Default)",
        true,
        auto_checked,
        None::<&str>,
    )?;
    items.push(auto_item);

    for dev in &devices {
        let label = if dev.is_default {
            format!("{} (Default)", dev.name)
        } else {
            dev.name.clone()
        };
        let id = format!("device_{}", dev.index);
        let checked = selected_idx == Some(dev.index);
        let item = CheckMenuItem::with_id(app, &id, &label, true, checked, None::<&str>)?;
        items.push(item);
    }

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>)
        .collect();

    let submenu = Submenu::with_items(app, "Input Device", true, &item_refs)?;
    Ok(submenu)
}

fn handle_menu_event(app: &tauri::AppHandle, id: &str, state: &Arc<Mutex<SendableState>>) {
    match id {
        "toggle_recording" => {
            let mut s = state.lock().unwrap();
            let current_state = s.recorder.state();
            match current_state {
                RecorderState::Idle => {
                    // Borrow device_manager via raw pointer to avoid
                    // simultaneous mutable + immutable borrow of `s`.
                    let dm_ptr = &s.device_manager as *const AudioDeviceManager;
                    // Safety: dm_ptr points into the same MutexGuard we hold,
                    // and `start` does not modify device_manager.
                    match s.recorder.start(unsafe { &*dm_ptr }) {
                        Ok(path) => {
                            println!("recording started: {}", path.display());
                            update_tray_icon(app, true);
                        }
                        Err(e) => {
                            eprintln!("failed to start recording: {e}");
                        }
                    }
                }
                RecorderState::Recording => match s.recorder.stop() {
                    Ok(path) => {
                        println!("recording saved: {}", path.display());
                        update_tray_icon(app, false);
                    }
                    Err(e) => {
                        eprintln!("failed to stop recording: {e}");
                    }
                },
            }
        }
        "set_output_dir" => {
            use tauri_plugin_dialog::DialogExt;
            let state_clone = state.clone();
            app.dialog().file().pick_folder(move |folder| {
                if let Some(path) = folder {
                    let mut s = state_clone.lock().unwrap();
                    if let Some(path_buf) = path.as_path() {
                        s.recorder.set_output_dir(path_buf.to_path_buf());
                        println!("output dir set to: {path}");
                    }
                }
            });
        }
        "open_output_dir" => {
            let s = state.lock().unwrap();
            let dir = s.recorder.config.output_dir.clone();
            drop(s);
            let _ = std::process::Command::new("open").arg(&dir).spawn();
        }
        "quit" => {
            let mut s = state.lock().unwrap();
            if s.recorder.state() == RecorderState::Recording {
                let _ = s.recorder.stop();
            }
            drop(s);
            app.exit(0);
        }
        id if id.starts_with("device_") => {
            let mut s = state.lock().unwrap();
            if id == "device_auto" {
                s.recorder.select_device(None);
                println!("device set to auto (default)");
            } else if let Some(idx_str) = id.strip_prefix("device_") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    s.recorder.select_device(Some(idx));
                    let devices = s.device_manager.list_input_devices();
                    let name = devices
                        .iter()
                        .find(|d| d.index == idx)
                        .map(|d| d.name.as_str())
                        .unwrap_or("unknown");
                    println!("device set to: {name}");
                }
            }
        }
        _ => {}
    }
}

fn update_tray_icon(app: &tauri::AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let icon_bytes = if recording {
            TRAY_ICON_RECORDING
        } else {
            TRAY_ICON_IDLE
        };
        if let Ok(icon) = Image::from_bytes(icon_bytes) {
            let _ = tray.set_icon(Some(icon));
            // Template icons are monochrome and adapt to dark/light menu bar.
            // Recording icon has a colored red dot, so disable template mode.
            let _ = tray.set_icon_as_template(!recording);
        }
        let tooltip = if recording {
            "Lyre Recorder (Recording...)"
        } else {
            "Lyre Recorder"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
