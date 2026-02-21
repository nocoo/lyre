//! End-to-end integration tests for the Lyre macOS app.
//!
//! These tests exercise real subsystems as independent processes would:
//! - Audio device enumeration and recording pipeline
//! - Local recording file management (list, delete, cleanup)
//! - Configuration persistence
//! - Full record → list → verify → delete lifecycle
//!
//! Tests that require an audio input device are skipped gracefully in CI
//! (where no audio hardware exists) using a helper check.

use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

use lyre::{
    batch_delete_recordings, delete_recording, find_cleanable_recordings, list_recordings,
    AudioDeviceManager, CleanupFilter, RecorderConfig, RecorderState,
};

// ============================================================================
// Helpers
// ============================================================================

/// Check if any audio input device is available.
fn has_audio_input() -> bool {
    let mgr = AudioDeviceManager::new();
    !mgr.list_input_devices().is_empty()
}

/// Create a minimal valid WAV file (0.1s of audio at 44100 Hz mono).
fn create_test_wav(path: &Path) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 44100,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).unwrap();
    for i in 0..4410_i16 {
        writer.write_sample(i).unwrap();
    }
    writer.finalize().unwrap();
}

/// Create a valid MP3 file with the given number of samples at 44100 Hz mono.
fn create_test_mp3(path: &Path, num_samples: usize) {
    use mp3lame_encoder::{Builder, FlushNoGap, MonoPcm};
    use std::io::Write;

    let mut builder = Builder::new().unwrap();
    builder.set_num_channels(1).unwrap();
    builder.set_sample_rate(44100).unwrap();
    builder
        .set_brate(mp3lame_encoder::Bitrate::Kbps192)
        .unwrap();
    builder.set_quality(mp3lame_encoder::Quality::Best).unwrap();
    let mut encoder = builder.build().unwrap();

    let samples = vec![0i16; num_samples];
    let input = MonoPcm(&samples);
    let mut mp3_buf = Vec::new();
    mp3_buf.reserve(mp3lame_encoder::max_required_buffer_size(num_samples));
    let encoded_size = encoder.encode(input, mp3_buf.spare_capacity_mut()).unwrap();
    unsafe { mp3_buf.set_len(encoded_size) };

    let mut flush_buf = Vec::new();
    flush_buf.reserve(mp3lame_encoder::max_required_buffer_size(0));
    let flush_size = encoder
        .flush::<FlushNoGap>(flush_buf.spare_capacity_mut())
        .unwrap();
    unsafe { flush_buf.set_len(flush_size) };

    let mut file = std::fs::File::create(path).unwrap();
    file.write_all(&mp3_buf).unwrap();
    file.write_all(&flush_buf).unwrap();
}

// ============================================================================
// 1. Audio device enumeration
// ============================================================================

#[test]
fn e2e_device_enumeration() {
    let mgr = AudioDeviceManager::new();
    let devices = mgr.list_input_devices();
    // Verify the call doesn't panic; print for manual inspection.
    for dev in &devices {
        println!(
            "  device[{}]: {} (default={})",
            dev.index, dev.name, dev.is_default
        );
    }
}

// ============================================================================
// 2. Recording pipeline (requires audio hardware)
// ============================================================================

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
        selected_device_index: None,
    };

    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

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
    let mut recorder = lyre::Recorder::new(config);

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
    let mut recorder = lyre::Recorder::new(config);
    let result = recorder.stop();
    assert!(result.is_err());
}

// ============================================================================
// 3. Record → List → Verify → Delete lifecycle (requires audio hardware)
// ============================================================================

#[test]
fn e2e_record_then_list_then_delete() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().unwrap();
    let output_dir = tmp_dir.path().to_path_buf();

    let config = RecorderConfig {
        output_dir: output_dir.clone(),
        selected_device_index: None,
    };
    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

    // Record for 500ms
    let recording_path = recorder.start(&device_manager).unwrap();
    thread::sleep(Duration::from_millis(500));
    recorder.stop().unwrap();

    // List recordings — should find the file we just recorded
    let recordings = list_recordings(&output_dir).unwrap();
    assert_eq!(recordings.len(), 1, "expected 1 recording after recording");

    let rec = &recordings[0];
    assert!(rec.name.starts_with("recording-"));
    assert!(rec.name.ends_with(".mp3"));
    assert!(rec.size > 0, "recording should have non-zero file size");
    assert!(
        rec.duration_secs.is_some(),
        "recording should have a readable duration"
    );
    assert!(
        rec.duration_secs.unwrap() > 0.0,
        "duration should be positive"
    );
    assert!(
        !rec.created_at.is_empty(),
        "created_at should be a non-empty ISO string"
    );
    assert_eq!(
        PathBuf::from(&rec.path),
        recording_path,
        "path should match the recorded file"
    );

    // Delete the recording
    delete_recording(&rec.path, &output_dir).unwrap();

    // Verify it's gone
    let recordings_after = list_recordings(&output_dir).unwrap();
    assert!(
        recordings_after.is_empty(),
        "recording list should be empty after deletion"
    );
    assert!(
        !PathBuf::from(&rec.path).exists(),
        "file should no longer exist on disk"
    );
}

// ============================================================================
// 4. Record to custom output directory with auto-creation
// ============================================================================

#[test]
fn e2e_record_to_custom_output_dir() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().unwrap();
    // Use a nested directory that doesn't exist yet — recorder should auto-create it
    let custom_dir = tmp_dir.path().join("deep").join("nested").join("output");
    assert!(!custom_dir.exists());

    let config = RecorderConfig {
        output_dir: custom_dir.clone(),
        selected_device_index: None,
    };
    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

    let path = recorder.start(&device_manager).unwrap();
    assert!(custom_dir.exists(), "output dir should be auto-created");
    assert!(path.starts_with(&custom_dir));

    thread::sleep(Duration::from_millis(300));
    recorder.stop().unwrap();

    // Verify the file ended up in the custom directory
    let recordings = list_recordings(&custom_dir).unwrap();
    assert_eq!(recordings.len(), 1);
}

// ============================================================================
// 5. Record with specific device index
// ============================================================================

#[test]
fn e2e_record_with_device_selection() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let mgr = AudioDeviceManager::new();
    let devices = mgr.list_input_devices();
    assert!(!devices.is_empty());

    // Pick the first available device explicitly
    let device_index = devices[0].index;

    let tmp_dir = TempDir::new().unwrap();
    let config = RecorderConfig {
        output_dir: tmp_dir.path().to_path_buf(),
        selected_device_index: Some(device_index),
    };
    let mut recorder = lyre::Recorder::new(config);

    let path = recorder.start(&mgr).unwrap();
    assert_eq!(recorder.state(), RecorderState::Recording);
    thread::sleep(Duration::from_millis(300));
    recorder.stop().unwrap();

    assert!(path.exists());
    assert!(std::fs::metadata(&path).unwrap().len() > 0);
}

#[test]
fn e2e_record_with_invalid_device_index() {
    let tmp_dir = TempDir::new().unwrap();
    let config = RecorderConfig {
        output_dir: tmp_dir.path().to_path_buf(),
        selected_device_index: Some(99999),
    };
    let mgr = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);
    let result = recorder.start(&mgr);
    assert!(result.is_err(), "should fail with invalid device index");
}

// ============================================================================
// 6. MP3 duration precision (record → list → verify duration matches time)
// ============================================================================

#[test]
fn e2e_mp3_duration_is_precise() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().unwrap();
    let output_dir = tmp_dir.path().to_path_buf();

    let config = RecorderConfig {
        output_dir: output_dir.clone(),
        selected_device_index: None,
    };
    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

    // Record for ~2 seconds
    let recording_duration_ms = 2000;
    recorder.start(&device_manager).unwrap();
    thread::sleep(Duration::from_millis(recording_duration_ms));
    recorder.stop().unwrap();

    let recordings = list_recordings(&output_dir).unwrap();
    assert_eq!(recordings.len(), 1);

    let duration = recordings[0]
        .duration_secs
        .expect("duration should be Some");
    let expected_secs = recording_duration_ms as f64 / 1000.0;
    // Allow 1.0s tolerance for MP3 encoder buffering, thread scheduling, etc.
    assert!(
        (duration - expected_secs).abs() < 1.0,
        "expected ~{expected_secs}s, got {duration}s — precision check failed"
    );
    // But duration should be > 0 and reasonably close
    assert!(
        duration > 0.5,
        "duration should be at least 0.5s for a 2s recording"
    );
    println!("  recorded {recording_duration_ms}ms, measured duration: {duration:.3}s");
    println!("  recorded {recording_duration_ms}ms, measured duration: {duration:.3}s");
}

// ============================================================================
// 7. Recording list management (no audio hardware needed)
// ============================================================================

#[test]
fn e2e_list_recordings_mixed_files() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    // Create mixed files
    create_test_wav(&dir.join("first.wav"));
    create_test_mp3(&dir.join("second.mp3"), 44100); // 1s
    std::fs::write(dir.join("readme.txt"), "not audio").unwrap();
    std::fs::write(dir.join("data.json"), "{}").unwrap();
    std::fs::write(dir.join(".hidden"), "hidden").unwrap();

    let recordings = list_recordings(dir).unwrap();

    // Should only include .wav and .mp3 files
    assert_eq!(recordings.len(), 2, "should list only wav + mp3 files");

    let names: Vec<&str> = recordings.iter().map(|r| r.name.as_str()).collect();
    assert!(names.contains(&"first.wav"));
    assert!(names.contains(&"second.mp3"));
}

#[test]
fn e2e_list_recordings_sorted_newest_first() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    // Create older file
    let older = dir.join("older.wav");
    create_test_wav(&older);
    let past = std::time::SystemTime::now() - Duration::from_secs(60);
    let past_ft = filetime::FileTime::from_system_time(past);
    filetime::set_file_mtime(&older, past_ft).unwrap();

    // Create newer file
    create_test_wav(&dir.join("newer.wav"));

    let recordings = list_recordings(dir).unwrap();
    assert_eq!(recordings.len(), 2);
    assert_eq!(recordings[0].name, "newer.wav", "newest should come first");
    assert_eq!(recordings[1].name, "older.wav", "oldest should come last");
}

#[test]
fn e2e_list_recordings_has_correct_metadata() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    // WAV: 0.1s (4410 samples at 44100 Hz)
    let wav_path = dir.join("test.wav");
    create_test_wav(&wav_path);

    // MP3: 1s (44100 samples at 44100 Hz)
    let mp3_path = dir.join("test.mp3");
    create_test_mp3(&mp3_path, 44100);

    let recordings = list_recordings(dir).unwrap();
    assert_eq!(recordings.len(), 2);

    for rec in &recordings {
        // All recordings should have positive file size
        assert!(rec.size > 0, "{}: size should be > 0", rec.name);

        // All recordings should have a duration
        assert!(
            rec.duration_secs.is_some(),
            "{}: should have duration",
            rec.name
        );
        assert!(
            rec.duration_secs.unwrap() > 0.0,
            "{}: duration should be positive",
            rec.name
        );

        // Path should resolve to a real file
        assert!(
            PathBuf::from(&rec.path).exists(),
            "{}: path should exist",
            rec.name
        );

        // created_at should be non-empty ISO string
        assert!(
            !rec.created_at.is_empty(),
            "{}: created_at should be set",
            rec.name
        );
    }

    // Verify WAV duration is approximately 0.1s
    let wav_rec = recordings.iter().find(|r| r.name == "test.wav").unwrap();
    assert!(
        (wav_rec.duration_secs.unwrap() - 0.1).abs() < 0.02,
        "WAV duration should be ~0.1s, got {}",
        wav_rec.duration_secs.unwrap()
    );

    // Verify MP3 duration is approximately 1.0s
    let mp3_rec = recordings.iter().find(|r| r.name == "test.mp3").unwrap();
    assert!(
        (mp3_rec.duration_secs.unwrap() - 1.0).abs() < 0.1,
        "MP3 duration should be ~1.0s, got {}",
        mp3_rec.duration_secs.unwrap()
    );
}

#[test]
fn e2e_list_recordings_empty_and_nonexistent() {
    // Empty directory
    let tmp_dir = TempDir::new().unwrap();
    let result = list_recordings(tmp_dir.path()).unwrap();
    assert!(result.is_empty());

    // Nonexistent directory — should return empty, not error
    let result = list_recordings(Path::new("/nonexistent/lyre/dir")).unwrap();
    assert!(result.is_empty());
}

// ============================================================================
// 8. Delete recording with path traversal security
// ============================================================================

#[test]
fn e2e_delete_recording_success() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    let wav_path = dir.join("to-delete.wav");
    create_test_wav(&wav_path);
    assert!(wav_path.exists());

    delete_recording(wav_path.to_str().unwrap(), dir).unwrap();
    assert!(!wav_path.exists(), "file should be deleted");

    // List should be empty
    let recordings = list_recordings(dir).unwrap();
    assert!(recordings.is_empty());
}

#[test]
fn e2e_delete_recording_path_traversal_blocked() {
    let output_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();

    // Create a file outside the output directory
    let outside_file = outside_dir.path().join("secret.wav");
    create_test_wav(&outside_file);
    assert!(outside_file.exists());

    // Attempt to delete it via the recordings API — should be rejected
    let result = delete_recording(outside_file.to_str().unwrap(), output_dir.path());
    assert!(result.is_err(), "should reject path outside output dir");
    assert!(
        result.unwrap_err().contains("outside"),
        "error should mention 'outside'"
    );
    assert!(
        outside_file.exists(),
        "file should NOT be deleted — security check blocked it"
    );
}

#[test]
fn e2e_delete_recording_nonexistent_file() {
    let tmp_dir = TempDir::new().unwrap();
    let ghost = tmp_dir.path().join("ghost.wav");
    let result = delete_recording(ghost.to_str().unwrap(), tmp_dir.path());
    assert!(result.is_err(), "should fail for nonexistent file");
}

// ============================================================================
// 9. Batch delete recordings
// ============================================================================

#[test]
fn e2e_batch_delete_all_succeed() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    // Create 3 files
    let files: Vec<_> = (1..=3)
        .map(|i| {
            let path = dir.join(format!("rec-{i}.wav"));
            create_test_wav(&path);
            path.to_string_lossy().into_owned()
        })
        .collect();

    let result = batch_delete_recordings(&files, dir);
    assert_eq!(result.deleted_count, 3);
    assert!(result.freed_bytes > 0);
    assert!(result.errors.is_empty());

    // All files should be gone
    let recordings = list_recordings(dir).unwrap();
    assert!(recordings.is_empty());
}

#[test]
fn e2e_batch_delete_partial_failure() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    let existing = dir.join("exists.wav");
    create_test_wav(&existing);

    let paths = vec![
        existing.to_string_lossy().into_owned(),
        dir.join("ghost.wav").to_string_lossy().into_owned(),
    ];
    let result = batch_delete_recordings(&paths, dir);

    assert_eq!(result.deleted_count, 1, "1 should succeed");
    assert_eq!(result.errors.len(), 1, "1 should fail");
    assert!(!existing.exists(), "existing file should be deleted");
}

#[test]
fn e2e_batch_delete_empty_list() {
    let tmp_dir = TempDir::new().unwrap();
    let result = batch_delete_recordings(&[], tmp_dir.path());
    assert_eq!(result.deleted_count, 0);
    assert_eq!(result.freed_bytes, 0);
    assert!(result.errors.is_empty());
}

// ============================================================================
// 10. Cleanup filter with real files on disk
// ============================================================================

#[test]
fn e2e_find_cleanable_recordings_with_real_files() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    // Create a short WAV (0.1s)
    let short_wav = dir.join("short.wav");
    create_test_wav(&short_wav);

    // Create a longer MP3 (2s)
    let long_mp3 = dir.join("long.mp3");
    create_test_mp3(&long_mp3, 88200); // 2 seconds

    // Create a large file (simulate by repeating WAV data)
    let big_wav = dir.join("big.wav");
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&big_wav, spec).unwrap();
        // Write 10s worth of samples
        for i in 0..441000_i32 {
            writer.write_sample(i as i16).unwrap();
        }
        writer.finalize().unwrap();
    }

    // List all recordings
    let recordings = list_recordings(dir).unwrap();
    assert_eq!(recordings.len(), 3);

    // Filter: short duration (< 1s) — should match short.wav only
    let filter = CleanupFilter {
        before_date: None,
        min_duration_secs: Some(1.0),
        max_duration_secs: None,
        max_size_bytes: None,
    };
    let cleanable = find_cleanable_recordings(&recordings, &filter);
    assert_eq!(cleanable.len(), 1);
    assert_eq!(cleanable[0].name, "short.wav");

    // Filter: large file (> 500KB) — should match big.wav only
    let filter = CleanupFilter {
        before_date: None,
        min_duration_secs: None,
        max_duration_secs: None,
        max_size_bytes: Some(500_000),
    };
    let cleanable = find_cleanable_recordings(&recordings, &filter);
    assert_eq!(cleanable.len(), 1);
    assert_eq!(cleanable[0].name, "big.wav");

    // Filter: no filters enabled — matches nothing
    let filter = CleanupFilter {
        before_date: None,
        min_duration_secs: None,
        max_duration_secs: None,
        max_size_bytes: None,
    };
    let cleanable = find_cleanable_recordings(&recordings, &filter);
    assert!(cleanable.is_empty());
}

#[test]
fn e2e_cleanup_then_batch_delete_lifecycle() {
    let tmp_dir = TempDir::new().unwrap();
    let dir = tmp_dir.path();

    // Create short recordings
    for i in 0..3 {
        create_test_wav(&dir.join(format!("short-{i}.wav")));
    }
    // Create a longer one
    create_test_mp3(&dir.join("keeper.mp3"), 88200); // 2s

    let recordings = list_recordings(dir).unwrap();
    assert_eq!(recordings.len(), 4);

    // Find short recordings (< 0.5s)
    let filter = CleanupFilter {
        before_date: None,
        min_duration_secs: Some(0.5),
        max_duration_secs: None,
        max_size_bytes: None,
    };
    let to_delete = find_cleanable_recordings(&recordings, &filter);
    assert_eq!(to_delete.len(), 3, "all short WAVs should match");

    // Batch delete them
    let paths: Vec<String> = to_delete.iter().map(|r| r.path.clone()).collect();
    let result = batch_delete_recordings(&paths, dir);
    assert_eq!(result.deleted_count, 3);
    assert!(result.errors.is_empty());

    // Only the keeper should remain
    let remaining = list_recordings(dir).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].name, "keeper.mp3");
}

// ============================================================================
// 11. Config persistence (isolated via $HOME override)
// ============================================================================

#[test]
fn e2e_config_roundtrip() {
    let tmp_dir = TempDir::new().unwrap();
    let original_home = std::env::var("HOME").ok();

    // Redirect $HOME to isolate config from real user data
    unsafe { std::env::set_var("HOME", tmp_dir.path()) };

    // Initially no config
    assert!(!lyre::has_config(), "should not have config initially");

    // Save server credentials
    lyre::save_config("https://lyre.example.com", "tok_test123").unwrap();
    assert!(lyre::has_config(), "should have config after save");

    let config = lyre::load_config().unwrap();
    assert_eq!(config.server_url, "https://lyre.example.com");
    assert_eq!(config.token, "tok_test123");
    assert!(config.output_dir.is_none());

    // Save output dir — should not clobber server config
    lyre::save_output_dir(Some("/custom/recordings")).unwrap();
    let config = lyre::load_config().unwrap();
    assert_eq!(config.server_url, "https://lyre.example.com");
    assert_eq!(config.token, "tok_test123");
    assert_eq!(config.output_dir, Some("/custom/recordings".to_string()));

    // get_output_dir should return the custom path
    let dir = lyre::get_output_dir();
    assert_eq!(dir, PathBuf::from("/custom/recordings"));

    // Overwrite server config — output_dir should survive
    lyre::save_config("https://new-server.dev", "tok_new").unwrap();
    let config = lyre::load_config().unwrap();
    assert_eq!(config.server_url, "https://new-server.dev");
    assert_eq!(config.output_dir, Some("/custom/recordings".to_string()));

    // Reset output dir
    lyre::save_output_dir(None).unwrap();
    let dir = lyre::get_output_dir();
    assert!(
        dir.to_string_lossy().contains("Lyre Recordings"),
        "should fall back to default dir after reset"
    );

    // Clear config entirely
    lyre::clear_config().unwrap();
    assert!(!lyre::has_config());

    // Restore $HOME
    if let Some(home) = original_home {
        unsafe { std::env::set_var("HOME", home) };
    }
}

// ============================================================================
// 12. Output directory change at runtime
// ============================================================================

#[test]
fn e2e_set_output_dir_then_record() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().unwrap();
    let dir1 = tmp_dir.path().join("dir1");
    let dir2 = tmp_dir.path().join("dir2");

    let config = RecorderConfig {
        output_dir: dir1.clone(),
        selected_device_index: None,
    };
    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

    // Record to dir1
    let path1 = recorder.start(&device_manager).unwrap();
    assert!(path1.starts_with(&dir1));
    thread::sleep(Duration::from_millis(300));
    recorder.stop().unwrap();

    // Change output dir
    recorder.set_output_dir(dir2.clone());

    // Record to dir2
    let path2 = recorder.start(&device_manager).unwrap();
    assert!(path2.starts_with(&dir2));
    thread::sleep(Duration::from_millis(300));
    recorder.stop().unwrap();

    // Each dir should have exactly 1 recording
    assert_eq!(list_recordings(&dir1).unwrap().len(), 1);
    assert_eq!(list_recordings(&dir2).unwrap().len(), 1);
}

// ============================================================================
// 13. Multiple sequential recordings
// ============================================================================

#[test]
fn e2e_multiple_sequential_recordings() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().unwrap();
    let output_dir = tmp_dir.path().to_path_buf();

    let config = RecorderConfig {
        output_dir: output_dir.clone(),
        selected_device_index: None,
    };
    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

    // Record 3 clips back-to-back
    for i in 0..3 {
        recorder.start(&device_manager).unwrap();
        thread::sleep(Duration::from_millis(300));
        recorder.stop().unwrap();
        println!("  recorded clip {}", i + 1);
        // Wait >1s to ensure distinct second-level timestamps in filenames
        if i < 2 {
            thread::sleep(Duration::from_millis(1100));
        }
    }

    // All 3 should appear in the listing
    let recordings = list_recordings(&output_dir).unwrap();
    assert_eq!(recordings.len(), 3, "should have 3 recordings");

    // All should have positive size and duration
    for rec in &recordings {
        assert!(rec.size > 0);
        assert!(rec.duration_secs.unwrap_or(0.0) > 0.0);
    }

    // Should be sorted newest-first
    assert!(
        recordings[0].created_at >= recordings[1].created_at,
        "should be newest first"
    );
    assert!(
        recordings[1].created_at >= recordings[2].created_at,
        "should be newest first"
    );
}

// ============================================================================
// 14. Recorder state machine integrity
// ============================================================================

#[test]
fn e2e_recorder_state_transitions() {
    if !has_audio_input() {
        println!("SKIP: no audio input device available");
        return;
    }

    let tmp_dir = TempDir::new().unwrap();
    let config = RecorderConfig {
        output_dir: tmp_dir.path().to_path_buf(),
        selected_device_index: None,
    };
    let device_manager = AudioDeviceManager::new();
    let mut recorder = lyre::Recorder::new(config);

    // Initial state
    assert_eq!(recorder.state(), RecorderState::Idle);

    // Stop while idle → error, state unchanged
    assert!(recorder.stop().is_err());
    assert_eq!(recorder.state(), RecorderState::Idle);

    // Start → Recording
    recorder.start(&device_manager).unwrap();
    assert_eq!(recorder.state(), RecorderState::Recording);

    // Start while recording → error, state unchanged
    assert!(recorder.start(&device_manager).is_err());
    assert_eq!(recorder.state(), RecorderState::Recording);

    // Stop → Idle
    thread::sleep(Duration::from_millis(200));
    recorder.stop().unwrap();
    assert_eq!(recorder.state(), RecorderState::Idle);

    // Can start again after stopping
    recorder.start(&device_manager).unwrap();
    assert_eq!(recorder.state(), RecorderState::Recording);
    thread::sleep(Duration::from_millis(200));
    recorder.stop().unwrap();
    assert_eq!(recorder.state(), RecorderState::Idle);
}

// ============================================================================
// 15. Filename generation
// ============================================================================

#[test]
fn e2e_generate_filename_format() {
    let f1 = lyre::generate_filename();
    thread::sleep(Duration::from_millis(10));
    let f2 = lyre::generate_filename();

    // Format: recording-YYYYMMDD-HHMMSS.mp3
    assert!(
        f1.starts_with("recording-"),
        "should start with 'recording-'"
    );
    assert!(f1.ends_with(".mp3"), "should end with '.mp3'");
    assert!(f1.len() > 20, "should have full timestamp");

    // Same second might produce same filename, but format should be consistent
    assert!(f2.starts_with("recording-"));
    assert!(f2.ends_with(".mp3"));
}
