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

/// Upload a local WAV file to the Lyre web app.
///
/// Reads config (server_url, token) from the Keychain, then performs
/// the 3-step upload: presign → PUT to OSS → create recording record.
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

    // Read file metadata
    let file_bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("failed to read file: {e}"))?;
    let file_size = file_bytes.len() as u64;

    // Read WAV metadata (duration, sample rate)
    let (duration, sample_rate) = wav_metadata(path);

    // Derive title from filename: "recording-20260221-143052.wav" → "recording-20260221-143052"
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.clone());

    let content_type = "audio/wav";
    let base_url = normalize_url(&config.server_url);

    let client = build_client(&config.token)?;

    // Step 1: Presign
    let presign = presign(&client, &base_url, &file_name, content_type).await?;

    // Step 2: Upload to OSS
    upload_to_oss(&client, &presign.upload_url, &file_bytes, content_type).await?;

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
) -> Result<(), String> {
    let url = format!("{base_url}/api/recordings");

    let body = CreateRecordingRequest {
        id: recording_id.to_string(),
        title: title.to_string(),
        file_name: file_name.to_string(),
        oss_key: oss_key.to_string(),
        file_size: Some(file_size),
        duration,
        format: "wav".to_string(),
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
