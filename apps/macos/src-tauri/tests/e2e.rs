//! Integration tests for the recorder module.
//!
//! These tests exercise the real audio pipeline end-to-end:
//! - Enumerate devices
//! - Start recording with a real (or default) device
//! - Record a short duration
//! - Stop and verify the output WAV file exists and is valid
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
fn e2e_record_and_verify_wav() {
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
        .map(|e| e == "wav")
        .unwrap_or(false));

    // Record for 500ms
    thread::sleep(Duration::from_millis(500));

    // Stop recording
    let saved_path = recorder.stop().expect("failed to stop recording");
    assert_eq!(recorder.state(), RecorderState::Idle);
    assert_eq!(saved_path, recording_path);

    // Verify WAV file exists and is non-empty
    let metadata = std::fs::metadata(&saved_path).expect("WAV file not found");
    assert!(
        metadata.len() > 44,
        "WAV file too small ({}B), expected at least a header",
        metadata.len()
    );

    // Verify WAV header is valid using hound
    let reader = hound::WavReader::open(&saved_path).expect("invalid WAV file");
    let spec = reader.spec();
    println!(
        "  WAV: {}ch, {}Hz, {}bit {:?}",
        spec.channels, spec.sample_rate, spec.bits_per_sample, spec.sample_format
    );
    assert!(spec.channels > 0);
    assert!(spec.sample_rate > 0);
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
