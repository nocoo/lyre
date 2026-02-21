//! Local recording file management.
//!
//! Scans the output directory for audio files (.mp3, .wav) and provides
//! metadata for the frontend recordings list.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::recorder::RecorderConfig;

/// Metadata for a single local recording file.
#[derive(Debug, Clone, Serialize)]
pub struct RecordingInfo {
    /// Full path to the file.
    pub path: String,
    /// File name only (e.g. "recording-20260221-143052.mp3").
    pub name: String,
    /// File size in bytes.
    pub size: u64,
    /// Duration in seconds (from WAV header), or None if unreadable.
    pub duration_secs: Option<f64>,
    /// File creation/modification timestamp as ISO 8601 string.
    pub created_at: String,
}

/// List all recording files (.mp3, .wav) in the output directory, sorted newest first.
pub fn list_recordings(output_dir: &Path) -> Result<Vec<RecordingInfo>, String> {
    if !output_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(output_dir).map_err(|e| format!("failed to read directory: {e}"))?;

    let mut recordings: Vec<RecordingInfo> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();

        // Only include audio files (.mp3, .wav)
        let is_audio = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("mp3") || ext.eq_ignore_ascii_case("wav"));
        if !is_audio || !path.is_file() {
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        let size = metadata.len();

        // Try to read duration from file header
        let duration_secs = audio_duration(&path);

        // Use modification time as "created at" (more reliable across filesystems)
        let created_at = metadata
            .modified()
            .or_else(|_| metadata.created())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let created_at_str = system_time_to_iso(created_at);

        recordings.push(RecordingInfo {
            path: path.to_string_lossy().into_owned(),
            name,
            size,
            duration_secs,
            created_at: created_at_str,
        });
    }

    // Sort newest first by created_at (reverse lexicographic on ISO strings)
    recordings.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(recordings)
}

/// Delete a recording file. Only allows deleting files inside the output directory.
pub fn delete_recording(file_path: &str, output_dir: &Path) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    // Security: ensure the file is inside the output directory
    let canonical_output = output_dir
        .canonicalize()
        .map_err(|e| format!("invalid output directory: {e}"))?;
    let canonical_file = path
        .canonicalize()
        .map_err(|e| format!("file not found: {e}"))?;

    if !canonical_file.starts_with(&canonical_output) {
        return Err("file is outside the recordings directory".to_string());
    }

    fs::remove_file(&canonical_file).map_err(|e| format!("failed to delete file: {e}"))
}

/// Get the default output directory (same logic as RecorderConfig::default).
pub fn default_output_dir() -> PathBuf {
    RecorderConfig::default().output_dir
}

// --- Internal helpers ---

/// Read audio duration from file.
/// Supports WAV (via hound header) and MP3 (estimated from file size).
fn audio_duration(path: &Path) -> Option<f64> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "wav" => wav_duration(path),
        "mp3" => mp3_duration_estimate(path),
        _ => None,
    }
}

/// Read WAV duration from file header using hound.
fn wav_duration(path: &Path) -> Option<f64> {
    let reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();
    let num_samples = reader.duration(); // total sample frames
    if spec.sample_rate == 0 {
        return None;
    }
    Some(num_samples as f64 / spec.sample_rate as f64)
}

/// Estimate MP3 duration from file size.
/// Assumes CBR encoding. The recorder uses 128 kbps by default.
fn mp3_duration_estimate(path: &Path) -> Option<f64> {
    let size = fs::metadata(path).ok()?.len();
    if size == 0 {
        return None;
    }
    // 128 kbps = 16000 bytes/sec
    let bitrate_bytes_per_sec = 16000.0_f64;
    Some(size as f64 / bitrate_bytes_per_sec)
}

/// Convert SystemTime to ISO 8601 string.
fn system_time_to_iso(time: SystemTime) -> String {
    let duration = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs() as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0)
        .unwrap_or_default()
        .with_timezone(&chrono::Local);
    dt.format("%Y-%m-%dT%H:%M:%S%z").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_recordings_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let result = list_recordings(tmp.path()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_list_recordings_nonexistent_dir() {
        let result = list_recordings(Path::new("/nonexistent/dir/xyz")).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_list_recordings_ignores_non_audio() {
        let tmp = tempfile::tempdir().unwrap();
        // Create a .txt file — should be ignored
        let txt_path = tmp.path().join("notes.txt");
        fs::write(&txt_path, "hello").unwrap();
        // Create a .wav file — should be included
        let wav_path = tmp.path().join("recording.wav");
        create_test_wav(&wav_path);
        // Create a .mp3 file — should be included
        let mp3_path = tmp.path().join("recording.mp3");
        fs::write(&mp3_path, vec![0u8; 16000]).unwrap();

        let result = list_recordings(tmp.path()).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_list_recordings_sorted_newest_first() {
        let tmp = tempfile::tempdir().unwrap();

        let wav1 = tmp.path().join("older.wav");
        create_test_wav(&wav1);

        // Set older modification time on the first file (10 seconds ago)
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(10);
        let past_ft = filetime::FileTime::from_system_time(past);
        filetime::set_file_mtime(&wav1, past_ft).unwrap();

        let wav2 = tmp.path().join("newer.wav");
        create_test_wav(&wav2);

        let result = list_recordings(tmp.path()).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "newer.wav");
        assert_eq!(result[1].name, "older.wav");
    }

    #[test]
    fn test_list_recordings_has_duration() {
        let tmp = tempfile::tempdir().unwrap();
        let wav_path = tmp.path().join("test.wav");
        create_test_wav(&wav_path);

        let result = list_recordings(tmp.path()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].duration_secs.is_some());
        assert!(result[0].size > 0);
    }

    #[test]
    fn test_delete_recording_success() {
        let tmp = tempfile::tempdir().unwrap();
        let wav_path = tmp.path().join("to-delete.wav");
        create_test_wav(&wav_path);
        assert!(wav_path.exists());

        delete_recording(wav_path.to_str().unwrap(), tmp.path()).unwrap();
        assert!(!wav_path.exists());
    }

    #[test]
    fn test_delete_recording_outside_dir() {
        let tmp1 = tempfile::tempdir().unwrap();
        let tmp2 = tempfile::tempdir().unwrap();
        let wav_path = tmp2.path().join("outside.wav");
        create_test_wav(&wav_path);

        let result = delete_recording(wav_path.to_str().unwrap(), tmp1.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside"));
        // File should still exist
        assert!(wav_path.exists());
    }

    #[test]
    fn test_delete_recording_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let result = delete_recording(tmp.path().join("ghost.wav").to_str().unwrap(), tmp.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_default_output_dir() {
        let dir = default_output_dir();
        assert!(dir.to_string_lossy().contains("Lyre Recordings"));
    }

    /// Create a minimal valid WAV file for testing.
    fn create_test_wav(path: &Path) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        // Write 4410 samples = 0.1 seconds
        for i in 0..4410_i16 {
            writer.write_sample(i).unwrap();
        }
        writer.finalize().unwrap();
    }
}
