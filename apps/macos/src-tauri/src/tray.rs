use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, Wry};

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
    let mut config = RecorderConfig::default();
    // Use persisted output_dir from config if available.
    config.output_dir = crate::config::get_output_dir();
    // Restore persisted input device selection.
    config.selected_device_name = crate::config::get_input_device();

    let state = Arc::new(Mutex::new(SendableState {
        recorder: Recorder::new(config),
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
        .tooltip("Lyre")
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

    // Open Lyre
    let open_item = MenuItem::with_id(handle, "open_lyre", "Open Lyre", true, None::<&str>)?;

    let quit = MenuItem::with_id(handle, "quit", "Quit Lyre", true, None::<&str>)?;

    // Build the items list dynamically since device count varies.
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = Vec::new();
    items.push(Box::new(toggle_item));
    items.push(Box::new(sep1));
    items.push(Box::new(device_header));
    for item in device_items {
        items.push(Box::new(item));
    }
    items.push(Box::new(sep2));
    items.push(Box::new(open_item));
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
    let selected_name = state.recorder.config.selected_device_name.as_deref();

    let mut items: Vec<CheckMenuItem<Wry>> = Vec::new();

    // "Auto (Default)" option
    let auto_checked = selected_name.is_none();
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
        let checked = selected_name == Some(dev.name.as_str());
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
                    // Sync output dir from config before starting (user may have changed it in Settings).
                    s.recorder.set_output_dir(crate::config::get_output_dir());
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
                        let _ = app.emit("recording-saved", ());
                    }
                    Err(e) => {
                        eprintln!("failed to stop recording: {e}");
                    }
                },
            }
            // Rebuild menu so "Start/Stop Recording" label updates
            rebuild_tray_menu(app, &s);
        }
        "open_lyre" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
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
                let _ = crate::config::save_input_device(None);
                println!("device set to auto (default)");
            } else if let Some(idx_str) = id.strip_prefix("device_") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    let devices = s.device_manager.list_input_devices();
                    if let Some(dev) = devices.iter().find(|d| d.index == idx) {
                        let name = dev.name.clone();
                        s.recorder.select_device(Some(name.clone()));
                        let _ = crate::config::save_input_device(Some(&name));
                        println!("device set to: {name}");
                    }
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
            "Lyre (Recording...)"
        } else {
            "Lyre"
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
