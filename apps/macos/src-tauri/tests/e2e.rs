//! Integration tests for the recorder module.
//!
//! These tests exercise the real audio pipeline end-to-end:
//! - Enumerate devices
//! - Start recording with a real (or default) device
//! - Record a short duration
//! - Stop and verify the output MP3 file exists and is valid
//!
//! Tests that require an audio input device are skipped in CI
//! (where no audio hardware exists) using a helper check.

use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

// Import from the crate under test
use lyre_recorder::{AudioDeviceManager, RecorderConfig, RecorderState};

/// Check if any audio input device is available.
fn has_audio_input() -> bool {
    let mgr = AudioDeviceManager::new();
    !mgr.list_input_devices().is_empty()
}

#[test]
fn e2e_device_enumeration() {
    let mgr = AudioDeviceManager::new();
    let devices = mgr.list_input_devices();
    // Just verify the call doesn't panic.
    // Print devices for manual inspection when run locally.
    for dev in &devices {
        println!(
            "  device[{}]: {} (default={})",
            dev.index, dev.name, dev.is_default
        );
    }
}

#[test]
fn e2e_record_and_verify_mp3() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().expect("failed to create temp dir");
    let output_dir = tmp_dir.path().to_path_buf();

    let config = RecorderConfig {
        output_dir: output_dir.clone(),
        selected_device_index: None, // use default device
    };

    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre_recorder::Recorder::new(config);

    // Start recording
    let recording_path = recorder
        .start(&device_manager)
        .expect("failed to start recording");
    assert_eq!(recorder.state(), RecorderState::Recording);
    assert!(recording_path.starts_with(&output_dir));
    assert!(recording_path
        .extension()
        .map(|e| e == "mp3")
        .unwrap_or(false));

    // Record for 500ms
    thread::sleep(Duration::from_millis(500));

    // Stop recording
    let saved_path = recorder.stop().expect("failed to stop recording");
    assert_eq!(recorder.state(), RecorderState::Idle);
    assert_eq!(saved_path, recording_path);

    // Verify MP3 file exists and is non-empty
    let metadata = std::fs::metadata(&saved_path).expect("MP3 file not found");
    assert!(
        metadata.len() > 100,
        "MP3 file too small ({}B), expected encoded audio data",
        metadata.len()
    );

    // Verify the file starts with valid MP3 frame sync or ID3 tag
    let header = std::fs::read(&saved_path).expect("failed to read MP3 file");
    let valid_mp3 = (header.len() >= 2 && header[0] == 0xFF && (header[1] & 0xE0) == 0xE0)
        || (header.len() >= 3 && &header[..3] == b"ID3");
    assert!(
        valid_mp3,
        "file does not start with MP3 frame sync or ID3 tag (first bytes: {:02X?})",
        &header[..header.len().min(4)]
    );
    println!("  MP3 file size: {} bytes", metadata.len());
}

#[test]
fn e2e_double_start_is_error() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().expect("failed to create temp dir");
    let config = RecorderConfig {
        output_dir: tmp_dir.path().to_path_buf(),
        selected_device_index: None,
    };

    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre_recorder::Recorder::new(config);

    recorder
        .start(&device_manager)
        .expect("first start should succeed");

    // Second start should fail
    let result = recorder.start(&device_manager);
    assert!(result.is_err());

    // Clean up
    let _ = recorder.stop();
}

#[test]
fn e2e_stop_without_start_is_error() {
    let config = RecorderConfig {
        output_dir: PathBuf::from("/tmp/lyre-test-unused"),
        selected_device_index: None,
    };
    let mut recorder = lyre_recorder::Recorder::new(config);
    let result = recorder.stop();
    assert!(result.is_err());
}
