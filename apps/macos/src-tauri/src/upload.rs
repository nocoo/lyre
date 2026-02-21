//! Upload recordings to the Lyre web app.
//!
//! Implements the 3-step upload flow:
//! 1. POST /api/upload/presign → get presigned OSS URL + recording ID
//! 2. PUT file bytes to OSS URL with matching content-type
//! 3. POST /api/recordings → create DB record

use std::path::Path;

use reqwest::header::{HeaderMap, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use crate::http_client::normalize_url;

/// Response from POST /api/upload/presign.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresignResponse {
    upload_url: String,
    oss_key: String,
    recording_id: String,
}

/// Request body for POST /api/recordings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateRecordingRequest {
    id: String,
    title: String,
    file_name: String,
    oss_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
    format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u32>,
}

/// Result of a successful upload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub recording_id: String,
    pub oss_key: String,
}

/// Upload a local audio file to the Lyre web app.
///
/// Reads config (server_url, token) from the config file, then performs
/// the 3-step upload: presign → PUT to OSS → create recording record.
///
/// Supported formats: MP3, WAV, M4A, AAC, OGG, FLAC, WebM.
pub async fn upload_recording(file_path: &str) -> Result<UploadResult, String> {
    let config = crate::config::load_config()?;
    if config.server_url.is_empty() || config.token.is_empty() {
        return Err("server URL and token must be configured first".to_string());
    }

    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("file not found: {file_path}"));
    }

    let file_name = path
        .file_name()
        .ok_or("invalid file path")?
        .to_string_lossy()
        .into_owned();

    // Detect audio format from extension
    let (content_type, format) = detect_audio_format(path)?;

    // Read file metadata
    let file_bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("failed to read file: {e}"))?;
    let file_size = file_bytes.len() as u64;

    // Read audio metadata (duration, sample rate) — format-aware
    let (duration, sample_rate) = audio_metadata(path, &format);

    // Derive title from filename: "recording-20260221-143052.mp3" → "recording-20260221-143052"
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.clone());

    let base_url = normalize_url(&config.server_url);

    let client = build_client(&config.token)?;

    // Step 1: Presign
    let presign = presign(&client, &base_url, &file_name, &content_type).await?;

    // Step 2: Upload to OSS
    upload_to_oss(&client, &presign.upload_url, &file_bytes, &content_type).await?;

    // Step 3: Create recording record
    create_recording(
        &client,
        &base_url,
        &presign.recording_id,
        &title,
        &file_name,
        &presign.oss_key,
        file_size,
        duration,
        sample_rate,
        &format,
    )
    .await?;

    Ok(UploadResult {
        recording_id: presign.recording_id,
        oss_key: presign.oss_key,
    })
}

fn build_client(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        format!("Bearer {token}")
            .parse()
            .map_err(|e| format!("invalid token: {e}"))?,
    );

    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(300)) // 5 min for large files
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

async fn presign(
    client: &reqwest::Client,
    base_url: &str,
    file_name: &str,
    content_type: &str,
) -> Result<PresignResponse, String> {
    let url = format!("{base_url}/api/upload/presign");

    let body = serde_json::json!({
        "fileName": file_name,
        "contentType": content_type,
    });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("presign request failed: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("authentication failed — check your device token".to_string());
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("presign failed (HTTP {status}): {text}"));
    }

    response
        .json::<PresignResponse>()
        .await
        .map_err(|e| format!("invalid presign response: {e}"))
}

async fn upload_to_oss(
    _auth_client: &reqwest::Client,
    upload_url: &str,
    file_bytes: &[u8],
    content_type: &str,
) -> Result<(), String> {
    // Use a fresh client without Authorization header for OSS
    let oss_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 min for large uploads
        .build()
        .map_err(|e| format!("failed to build OSS client: {e}"))?;

    let response = oss_client
        .put(upload_url)
        .header(CONTENT_TYPE, content_type)
        .body(file_bytes.to_vec())
        .send()
        .await
        .map_err(|e| format!("OSS upload failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OSS upload failed (HTTP {status}): {text}"));
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn create_recording(
    client: &reqwest::Client,
    base_url: &str,
    recording_id: &str,
    title: &str,
    file_name: &str,
    oss_key: &str,
    file_size: u64,
    duration: Option<f64>,
    sample_rate: Option<u32>,
    format: &str,
) -> Result<(), String> {
    let url = format!("{base_url}/api/recordings");

    let body = CreateRecordingRequest {
        id: recording_id.to_string(),
        title: title.to_string(),
        file_name: file_name.to_string(),
        oss_key: oss_key.to_string(),
        file_size: Some(file_size),
        duration,
        format: format.to_string(),
        sample_rate,
    };

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("create recording failed: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("authentication failed — check your device token".to_string());
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("create recording failed (HTTP {status}): {text}"));
    }

    Ok(())
}

/// Detect audio format from file extension.
/// Returns (content_type, format) e.g. ("audio/mpeg", "mp3") or ("audio/mp4", "m4a").
fn detect_audio_format(path: &Path) -> Result<(String, String), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "mp3" => Ok(("audio/mpeg".to_string(), "mp3".to_string())),
        "wav" => Ok(("audio/wav".to_string(), "wav".to_string())),
        "m4a" => Ok(("audio/mp4".to_string(), "m4a".to_string())),
        "aac" => Ok(("audio/aac".to_string(), "aac".to_string())),
        "ogg" | "oga" => Ok(("audio/ogg".to_string(), "ogg".to_string())),
        "flac" => Ok(("audio/flac".to_string(), "flac".to_string())),
        "webm" => Ok(("audio/webm".to_string(), "webm".to_string())),
        _ => Err(format!("unsupported audio format: .{ext}")),
    }
}

/// Read audio metadata (duration in seconds, sample rate in Hz).
/// For WAV files, reads from the header. For MP3 files, parses frame headers.
fn audio_metadata(path: &Path, format: &str) -> (Option<f64>, Option<u32>) {
    match format {
        "wav" => wav_metadata(path),
        "mp3" => mp3_metadata(path),
        _ => (None, None),
    }
}

/// Read WAV metadata (duration in seconds, sample rate in Hz).
fn wav_metadata(path: &Path) -> (Option<f64>, Option<u32>) {
    match hound::WavReader::open(path) {
        Ok(reader) => {
            let spec = reader.spec();
            let duration = if spec.sample_rate > 0 {
                Some(reader.duration() as f64 / spec.sample_rate as f64)
            } else {
                None
            };
            (duration, Some(spec.sample_rate))
        }
        Err(_) => (None, None),
    }
}

/// Read MP3 metadata (duration in seconds, sample rate in Hz) by parsing frame headers.
fn mp3_metadata(path: &Path) -> (Option<f64>, Option<u32>) {
    match mp3_duration::from_path(path) {
        Ok(duration) => {
            let secs = duration.as_secs_f64();
            if secs <= 0.0 {
                (None, None)
            } else {
                // Sample rate is not exposed by mp3-duration; default to None.
                (Some(secs), None)
            }
        }
        Err(_) => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wav_metadata_valid() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.wav");

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for i in 0..44100_u32 {
            writer.write_sample(i as i16).unwrap();
        }
        writer.finalize().unwrap();

        let (duration, sample_rate) = wav_metadata(&path);
        assert_eq!(sample_rate, Some(44100));
        // 44100 samples / 44100 Hz = 1.0 second
        assert!((duration.unwrap() - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_wav_metadata_invalid_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("not-a-wav.wav");
        std::fs::write(&path, "not wav data").unwrap();

        let (duration, sample_rate) = wav_metadata(&path);
        assert!(duration.is_none());
        assert!(sample_rate.is_none());
    }

    #[test]
    fn test_wav_metadata_missing_file() {
        let (duration, sample_rate) = wav_metadata(Path::new("/nonexistent.wav"));
        assert!(duration.is_none());
        assert!(sample_rate.is_none());
    }

    #[test]
    fn test_detect_audio_format_mp3() {
        let (content_type, format) = detect_audio_format(Path::new("test.mp3")).unwrap();
        assert_eq!(content_type, "audio/mpeg");
        assert_eq!(format, "mp3");
    }

    #[test]
    fn test_detect_audio_format_wav() {
        let (content_type, format) = detect_audio_format(Path::new("test.wav")).unwrap();
        assert_eq!(content_type, "audio/wav");
        assert_eq!(format, "wav");
    }

    #[test]
    fn test_detect_audio_format_unsupported() {
        let result = detect_audio_format(Path::new("test.xyz"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unsupported"));
    }

    #[test]
    fn test_detect_audio_format_m4a() {
        let (content_type, format) = detect_audio_format(Path::new("test.m4a")).unwrap();
        assert_eq!(content_type, "audio/mp4");
        assert_eq!(format, "m4a");
    }

    #[test]
    fn test_detect_audio_format_aac() {
        let (content_type, format) = detect_audio_format(Path::new("test.aac")).unwrap();
        assert_eq!(content_type, "audio/aac");
        assert_eq!(format, "aac");
    }

    #[test]
    fn test_detect_audio_format_ogg() {
        let (content_type, format) = detect_audio_format(Path::new("test.ogg")).unwrap();
        assert_eq!(content_type, "audio/ogg");
        assert_eq!(format, "ogg");
    }

    #[test]
    fn test_detect_audio_format_flac() {
        let (content_type, format) = detect_audio_format(Path::new("test.flac")).unwrap();
        assert_eq!(content_type, "audio/flac");
        assert_eq!(format, "flac");
    }

    #[test]
    fn test_detect_audio_format_webm() {
        let (content_type, format) = detect_audio_format(Path::new("test.webm")).unwrap();
        assert_eq!(content_type, "audio/webm");
        assert_eq!(format, "webm");
    }

    /// Create a valid MP3 file with the given number of samples at 44100 Hz mono.
    fn create_test_mp3(path: &Path, num_samples: usize) {
        use std::io::Write;

        let mut builder = mp3lame_encoder::Builder::new().unwrap();
        builder.set_num_channels(1).unwrap();
        builder.set_sample_rate(44100).unwrap();
        builder
            .set_brate(mp3lame_encoder::Bitrate::Kbps192)
            .unwrap();
        builder
            .set_quality(mp3lame_encoder::Quality::Best)
            .unwrap();
        let mut encoder = builder.build().unwrap();

        let samples = vec![0i16; num_samples];
        let input = mp3lame_encoder::MonoPcm(&samples);
        let mut mp3_buf = Vec::new();
        mp3_buf.reserve(mp3lame_encoder::max_required_buffer_size(num_samples));
        let encoded_size = encoder
            .encode(input, mp3_buf.spare_capacity_mut())
            .unwrap();
        unsafe { mp3_buf.set_len(encoded_size) };

        let mut flush_buf = Vec::new();
        flush_buf.reserve(mp3lame_encoder::max_required_buffer_size(0));
        let flush_size = encoder
            .flush::<mp3lame_encoder::FlushNoGap>(flush_buf.spare_capacity_mut())
            .unwrap();
        unsafe { flush_buf.set_len(flush_size) };

        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(&mp3_buf).unwrap();
        file.write_all(&flush_buf).unwrap();
    }

    #[test]
    fn test_mp3_metadata_valid_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.mp3");
        create_test_mp3(&path, 44100); // 1 second of silence

        let (duration, _sample_rate) = mp3_metadata(&path);
        // Should be approximately 1 second (allow some MP3 padding tolerance)
        assert!(duration.is_some(), "duration should be Some");
        assert!(
            (duration.unwrap() - 1.0).abs() < 0.1,
            "expected ~1.0s, got {}",
            duration.unwrap()
        );
    }

    #[test]
    fn test_mp3_metadata_invalid_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("not-mp3.mp3");
        std::fs::write(&path, "not mp3 data").unwrap();

        let (duration, sample_rate) = mp3_metadata(&path);
        assert!(duration.is_none());
        assert!(sample_rate.is_none());
    }

    #[test]
    fn test_mp3_metadata_missing_file() {
        let (duration, sample_rate) = mp3_metadata(Path::new("/nonexistent.mp3"));
        assert!(duration.is_none());
        assert!(sample_rate.is_none());
    }

    #[test]
    fn test_audio_metadata_wav() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.wav");

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for i in 0..44100_u32 {
            writer.write_sample(i as i16).unwrap();
        }
        writer.finalize().unwrap();

        let (duration, sample_rate) = audio_metadata(&path, "wav");
        assert_eq!(sample_rate, Some(44100));
        assert!((duration.unwrap() - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_audio_metadata_mp3() {
        // Create a real MP3 file and verify audio_metadata dispatches correctly
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.mp3");
        create_test_mp3(&path, 44100); // 1 second

        let (duration, _sample_rate) = audio_metadata(&path, "mp3");
        assert!(duration.is_some(), "mp3 duration should be Some");
        assert!(
            (duration.unwrap() - 1.0).abs() < 0.1,
            "expected ~1.0s, got {}",
            duration.unwrap()
        );
    }

    #[test]
    fn test_create_recording_request_serialization() {
        let req = CreateRecordingRequest {
            id: "abc-123".to_string(),
            title: "Test Recording".to_string(),
            file_name: "test.wav".to_string(),
            oss_key: "uploads/user1/abc-123/test.wav".to_string(),
            file_size: Some(1024),
            duration: Some(3.5),
            format: "wav".to_string(),
            sample_rate: Some(44100),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"id\":\"abc-123\""));
        assert!(json.contains("\"fileName\":\"test.wav\""));
        assert!(json.contains("\"ossKey\""));
        assert!(json.contains("\"fileSize\":1024"));
        assert!(json.contains("\"sampleRate\":44100"));
    }

    #[test]
    fn test_create_recording_request_mp3_format() {
        let req = CreateRecordingRequest {
            id: "mp3-123".to_string(),
            title: "Test MP3".to_string(),
            file_name: "test.mp3".to_string(),
            oss_key: "uploads/user1/mp3-123/test.mp3".to_string(),
            file_size: Some(48000),
            duration: Some(2.0),
            format: "mp3".to_string(),
            sample_rate: Some(44100),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"format\":\"mp3\""));
        assert!(json.contains("\"fileName\":\"test.mp3\""));
    }

    #[test]
    fn test_create_recording_request_skips_none() {
        let req = CreateRecordingRequest {
            id: "abc".to_string(),
            title: "Test".to_string(),
            file_name: "test.wav".to_string(),
            oss_key: "key".to_string(),
            file_size: None,
            duration: None,
            format: "wav".to_string(),
            sample_rate: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("fileSize"));
        assert!(!json.contains("duration"));
        assert!(!json.contains("sampleRate"));
    }
}
