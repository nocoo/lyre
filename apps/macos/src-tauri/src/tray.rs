use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Wry};

use crate::audio::AudioDeviceManager;
use crate::recorder::{Recorder, RecorderConfig, RecorderState};

// Tray icons embedded at compile time.
// Idle icon: pure black foreground + alpha (macOS template image).
// Recording icon: same shape with a red dot overlay (non-template, so red stays red).
const TRAY_ICON_IDLE: &[u8] = include_bytes!("../icons/tray-icon.png");
const TRAY_ICON_RECORDING: &[u8] = include_bytes!("../icons/tray-icon-recording.png");

/// Shared state that is Send+Sync safe.
struct SendableState {
    recorder: Recorder,
    device_manager: AudioDeviceManager,
}

// Safety: On macOS, Tauri menu events are dispatched on the main thread.
// The cpal::Stream inside Recorder is only accessed from menu event handlers,
// which all run on the same (main) thread.
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
        build_tray_menu(app.handle(), &s)?
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
    handle: &AppHandle,
    state: &SendableState,
) -> Result<Menu<Wry>, Box<dyn std::error::Error>> {
    let is_recording = state.recorder.state() == RecorderState::Recording;

    // Toggle recording
    let toggle_label = if is_recording {
        "⏹ Stop Recording"
    } else {
        "⏺ Start Recording"
    };
    let toggle_item =
        MenuItem::with_id(handle, "toggle_recording", toggle_label, true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(handle)?;

    // Flat device list (avoids Tauri v2 submenu hover/tracking bug on macOS).
    // Section header (disabled menu item as label).
    let device_header =
        MenuItem::with_id(handle, "device_header", "Input Device", false, None::<&str>)?;
    let device_items = build_device_items(handle, state)?;

    let sep2 = PredefinedMenuItem::separator(handle)?;

    // Output folder display
    let output_dir_display = state
        .recorder
        .config
        .output_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    let output_item = MenuItem::with_id(
        handle,
        "set_output_dir",
        format!("Output: {output_dir_display}..."),
        !is_recording,
        None::<&str>,
    )?;

    // Open output folder
    let open_folder = MenuItem::with_id(
        handle,
        "open_output_dir",
        "Open Output Folder",
        true,
        None::<&str>,
    )?;

    let sep3 = PredefinedMenuItem::separator(handle)?;

    let quit = MenuItem::with_id(handle, "quit", "Quit Lyre Recorder", true, None::<&str>)?;

    // Build the items list dynamically since device count varies.
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = Vec::new();
    items.push(Box::new(toggle_item));
    items.push(Box::new(sep1));
    items.push(Box::new(device_header));
    for item in device_items {
        items.push(Box::new(item));
    }
    items.push(Box::new(sep2));
    items.push(Box::new(output_item));
    items.push(Box::new(open_folder));
    items.push(Box::new(sep3));
    items.push(Box::new(quit));

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        items.iter().map(|i| i.as_ref()).collect();

    let menu = Menu::with_items(handle, &item_refs)?;
    Ok(menu)
}

/// Build flat list of device check-menu-items (no submenu).
fn build_device_items(
    handle: &AppHandle,
    state: &SendableState,
) -> Result<Vec<CheckMenuItem<Wry>>, Box<dyn std::error::Error>> {
    let devices = state.device_manager.list_input_devices();
    let selected_idx = state.recorder.config.selected_device_index;

    let mut items: Vec<CheckMenuItem<Wry>> = Vec::new();

    // "Auto (Default)" option
    let auto_checked = selected_idx.is_none();
    let auto_item = CheckMenuItem::with_id(
        handle,
        "device_auto",
        "  Auto (Default)",
        true,
        auto_checked,
        None::<&str>,
    )?;
    items.push(auto_item);

    for dev in &devices {
        let label = if dev.is_default {
            format!("  {} (Default)", dev.name)
        } else {
            format!("  {}", dev.name)
        };
        let id = format!("device_{}", dev.index);
        let checked = selected_idx == Some(dev.index);
        let item = CheckMenuItem::with_id(handle, &id, &label, true, checked, None::<&str>)?;
        items.push(item);
    }

    Ok(items)
}

fn handle_menu_event(app: &AppHandle, id: &str, state: &Arc<Mutex<SendableState>>) {
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
            // Rebuild menu so "Start/Stop Recording" label updates
            rebuild_tray_menu(app, &s);
        }
        "set_output_dir" => {
            use tauri_plugin_dialog::DialogExt;
            let state_clone = state.clone();
            let app_handle = app.clone();
            app.dialog().file().pick_folder(move |folder| {
                if let Some(path) = folder {
                    let mut s = state_clone.lock().unwrap();
                    if let Some(path_buf) = path.as_path() {
                        s.recorder.set_output_dir(path_buf.to_path_buf());
                        println!("output dir set to: {path}");
                    }
                    rebuild_tray_menu(&app_handle, &s);
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
            rebuild_tray_menu(app, &s);
        }
        _ => {}
    }
}

fn update_tray_icon(app: &AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let icon_bytes = if recording {
            TRAY_ICON_RECORDING
        } else {
            TRAY_ICON_IDLE
        };
        if let Ok(icon) = Image::from_bytes(icon_bytes) {
            let _ = tray.set_icon(Some(icon));
            // Idle: template mode (macOS adapts to light/dark menu bar).
            // Recording: non-template so the red dot retains its color.
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

/// Rebuild the tray menu to reflect current state (recording label, device selection, etc.)
fn rebuild_tray_menu(app: &AppHandle, state: &SendableState) {
    let menu = match build_tray_menu(app, state) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("failed to rebuild tray menu: {e}");
            return;
        }
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_menu(Some(menu));
    }
}
