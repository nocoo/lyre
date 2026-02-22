//! Upload recordings to the Lyre web app.
//!
//! Implements the 3-step upload flow with progress tracking and cancellation:
//! 1. POST /api/upload/presign -> get presigned OSS URL + recording ID
//! 2. PUT file bytes to OSS URL with byte-level progress events
//! 3. POST /api/recordings -> create DB record with custom metadata

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use reqwest::header::{HeaderMap, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tag_ids: Option<Vec<String>>,
}

/// Result of a successful upload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub recording_id: String,
    pub oss_key: String,
}

/// Upload progress event emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    /// Current phase: "presigning", "uploading", "creating", "completed", "cancelled", "error"
    pub phase: String,
    /// Bytes uploaded so far (only meaningful during "uploading" phase)
    pub bytes_sent: u64,
    /// Total file size in bytes
    pub bytes_total: u64,
    /// Error message if phase is "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Options for upload, passed from the frontend form.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadOptions {
    pub file_path: String,
    /// Custom title (overrides filename-derived default).
    #[serde(default)]
    pub title: Option<String>,
    /// Folder ID to assign the recording to.
    #[serde(default)]
    pub folder_id: Option<String>,
    /// Tag IDs to assign to the recording.
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
}

/// A folder from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFolder {
    pub id: String,
    pub name: String,
    pub icon: String,
}

/// A tag from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerTag {
    pub id: String,
    pub name: String,
}

/// Shared cancellation flag for the active upload.
/// Uses AtomicBool so it can be checked from both the upload task and the frontend.
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

/// Request cancellation of the current upload.
pub fn cancel_upload() {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
}

/// Check if cancellation has been requested.
fn is_cancelled() -> bool {
    CANCEL_FLAG.load(Ordering::SeqCst)
}

/// Reset the cancellation flag (called at the start of each upload).
fn reset_cancel() {
    CANCEL_FLAG.store(false, Ordering::SeqCst);
}

/// Emit an upload progress event to the frontend.
fn emit_progress(app: &tauri::AppHandle, progress: &UploadProgress) {
    let _ = app.emit("upload-progress", progress);
}

/// Fetch folders from the Lyre web server.
pub async fn fetch_folders() -> Result<Vec<ServerFolder>, String> {
    let config = crate::config::load_config()?;
    if config.server_url.is_empty() || config.token.is_empty() {
        return Err("server URL and token must be configured first".to_string());
    }

    let base_url = normalize_url(&config.server_url);
    let client = build_client(&config.token)?;
    let url = format!("{base_url}/api/folders");

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch folders: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("authentication failed -- check your device token".to_string());
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("failed to fetch folders (HTTP {status}): {text}"));
    }

    #[derive(Deserialize)]
    struct FoldersResponse {
        items: Vec<ServerFolder>,
    }

    let body: FoldersResponse = response
        .json()
        .await
        .map_err(|e| format!("invalid folders response: {e}"))?;

    Ok(body.items)
}

/// Fetch tags from the Lyre web server.
pub async fn fetch_tags() -> Result<Vec<ServerTag>, String> {
    let config = crate::config::load_config()?;
    if config.server_url.is_empty() || config.token.is_empty() {
        return Err("server URL and token must be configured first".to_string());
    }

    let base_url = normalize_url(&config.server_url);
    let client = build_client(&config.token)?;
    let url = format!("{base_url}/api/tags");

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch tags: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("authentication failed -- check your device token".to_string());
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("failed to fetch tags (HTTP {status}): {text}"));
    }

    #[derive(Deserialize)]
    struct TagsResponse {
        items: Vec<ServerTag>,
    }

    let body: TagsResponse = response
        .json()
        .await
        .map_err(|e| format!("invalid tags response: {e}"))?;

    Ok(body.items)
}

/// Upload a local audio file to the Lyre web app with progress and cancellation support.
///
/// Reads config (server_url, token) from the config file, then performs
/// the 3-step upload: presign -> PUT to OSS -> create recording record.
///
/// Emits `upload-progress` events to the frontend throughout the process.
/// Checks the cancellation flag between each step and during the byte upload.
///
/// Supported formats: MP3, WAV, M4A, AAC, OGG, FLAC, WebM.
pub async fn upload_recording_with_progress(
    app: tauri::AppHandle,
    options: UploadOptions,
) -> Result<UploadResult, String> {
    reset_cancel();

    let file_path = &options.file_path;
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

    // Read file bytes
    let file_bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("failed to read file: {e}"))?;
    let file_size = file_bytes.len() as u64;

    // Read audio metadata (duration, sample rate)
    let (duration, sample_rate) = audio_metadata(path, &format);

    // Title: use custom title from options, or derive from filename
    let title = options
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| file_name.clone())
        });

    let base_url = normalize_url(&config.server_url);
    let client = build_client(&config.token)?;

    // --- Step 1: Presign ---
    if is_cancelled() {
        emit_progress(&app, &UploadProgress {
            phase: "cancelled".to_string(),
            bytes_sent: 0,
            bytes_total: file_size,
            error: None,
        });
        return Err("upload cancelled".to_string());
    }

    emit_progress(&app, &UploadProgress {
        phase: "presigning".to_string(),
        bytes_sent: 0,
        bytes_total: file_size,
        error: None,
    });

    let presign_result = presign(&client, &base_url, &file_name, &content_type).await?;

    // --- Step 2: Upload to OSS with progress ---
    if is_cancelled() {
        emit_progress(&app, &UploadProgress {
            phase: "cancelled".to_string(),
            bytes_sent: 0,
            bytes_total: file_size,
            error: None,
        });
        return Err("upload cancelled".to_string());
    }

    emit_progress(&app, &UploadProgress {
        phase: "uploading".to_string(),
        bytes_sent: 0,
        bytes_total: file_size,
        error: None,
    });

    upload_to_oss_with_progress(
        &app,
        &presign_result.upload_url,
        file_bytes,
        &content_type,
        file_size,
    )
    .await?;

    // --- Step 3: Create recording record ---
    if is_cancelled() {
        emit_progress(&app, &UploadProgress {
            phase: "cancelled".to_string(),
            bytes_sent: file_size,
            bytes_total: file_size,
            error: None,
        });
        return Err("upload cancelled".to_string());
    }

    emit_progress(&app, &UploadProgress {
        phase: "creating".to_string(),
        bytes_sent: file_size,
        bytes_total: file_size,
        error: None,
    });

    create_recording(
        &client,
        &base_url,
        &presign_result.recording_id,
        &title,
        &file_name,
        &presign_result.oss_key,
        file_size,
        duration,
        sample_rate,
        &format,
        options.folder_id,
        options.tag_ids,
    )
    .await?;

    emit_progress(&app, &UploadProgress {
        phase: "completed".to_string(),
        bytes_sent: file_size,
        bytes_total: file_size,
        error: None,
    });

    Ok(UploadResult {
        recording_id: presign_result.recording_id,
        oss_key: presign_result.oss_key,
    })
}

/// Legacy upload function without progress tracking (kept for backward compat and tests).
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

    let (content_type, format) = detect_audio_format(path)?;

    let file_bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("failed to read file: {e}"))?;
    let file_size = file_bytes.len() as u64;

    let (duration, sample_rate) = audio_metadata(path, &format);

    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.clone());

    let base_url = normalize_url(&config.server_url);
    let client = build_client(&config.token)?;

    let presign_result = presign(&client, &base_url, &file_name, &content_type).await?;

    upload_to_oss(&presign_result.upload_url, &file_bytes, &content_type).await?;

    create_recording(
        &client,
        &base_url,
        &presign_result.recording_id,
        &title,
        &file_name,
        &presign_result.oss_key,
        file_size,
        duration,
        sample_rate,
        &format,
        None,
        None,
    )
    .await?;

    Ok(UploadResult {
        recording_id: presign_result.recording_id,
        oss_key: presign_result.oss_key,
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
        return Err("authentication failed -- check your device token".to_string());
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

/// Upload to OSS with byte-level progress tracking and cancellation support.
async fn upload_to_oss_with_progress(
    app: &tauri::AppHandle,
    upload_url: &str,
    file_bytes: Vec<u8>,
    content_type: &str,
    file_size: u64,
) -> Result<(), String> {
    use futures_util::StreamExt;

    // Use a fresh client without Authorization header for OSS
    let oss_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 min for large uploads
        .build()
        .map_err(|e| format!("failed to build OSS client: {e}"))?;

    // Chunk size for progress reporting (64 KB)
    const CHUNK_SIZE: usize = 64 * 1024;

    let bytes_sent = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let bytes_sent_clone = bytes_sent.clone();
    let app_clone = app.clone();

    // Create a stream of chunks from the file bytes
    let chunks: Vec<Result<bytes::Bytes, std::io::Error>> = file_bytes
        .chunks(CHUNK_SIZE)
        .map(|chunk| Ok(bytes::Bytes::copy_from_slice(chunk)))
        .collect();

    let stream = futures_util::stream::iter(chunks).map(move |chunk_result: Result<bytes::Bytes, std::io::Error>| {
        if let Ok(chunk) = &chunk_result {
            let sent = bytes_sent_clone.fetch_add(chunk.len() as u64, Ordering::SeqCst)
                + chunk.len() as u64;
            emit_progress(
                &app_clone,
                &UploadProgress {
                    phase: "uploading".to_string(),
                    bytes_sent: sent,
                    bytes_total: file_size,
                    error: None,
                },
            );
        }
        chunk_result
    });

    let body = reqwest::Body::wrap_stream(stream);

    let response = oss_client
        .put(upload_url)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, file_size)
        .body(body)
        .send()
        .await
        .map_err(|e| {
            if is_cancelled() {
                "upload cancelled".to_string()
            } else {
                format!("OSS upload failed: {e}")
            }
        })?;

    if is_cancelled() {
        return Err("upload cancelled".to_string());
    }

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OSS upload failed (HTTP {status}): {text}"));
    }

    Ok(())
}

/// Legacy OSS upload without progress (for backward compat).
async fn upload_to_oss(
    upload_url: &str,
    file_bytes: &[u8],
    content_type: &str,
) -> Result<(), String> {
    let oss_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
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
    folder_id: Option<String>,
    tag_ids: Option<Vec<String>>,
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
        folder_id,
        tag_ids,
    };

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("create recording failed: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("authentication failed -- check your device token".to_string());
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
            folder_id: None,
            tag_ids: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"id\":\"abc-123\""));
        assert!(json.contains("\"fileName\":\"test.wav\""));
        assert!(json.contains("\"ossKey\""));
        assert!(json.contains("\"fileSize\":1024"));
        assert!(json.contains("\"sampleRate\":44100"));
        // folder_id and tag_ids should be absent when None
        assert!(!json.contains("folderId"));
        assert!(!json.contains("tagIds"));
    }

    #[test]
    fn test_create_recording_request_with_folder_and_tags() {
        let req = CreateRecordingRequest {
            id: "abc-123".to_string(),
            title: "Test Recording".to_string(),
            file_name: "test.wav".to_string(),
            oss_key: "uploads/user1/abc-123/test.wav".to_string(),
            file_size: Some(1024),
            duration: Some(3.5),
            format: "wav".to_string(),
            sample_rate: Some(44100),
            folder_id: Some("folder-1".to_string()),
            tag_ids: Some(vec!["tag-1".to_string(), "tag-2".to_string()]),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"folderId\":\"folder-1\""));
        assert!(json.contains("\"tagIds\":[\"tag-1\",\"tag-2\"]"));
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
            folder_id: None,
            tag_ids: None,
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
            folder_id: None,
            tag_ids: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("fileSize"));
        assert!(!json.contains("duration"));
        assert!(!json.contains("sampleRate"));
        assert!(!json.contains("folderId"));
        assert!(!json.contains("tagIds"));
    }

    #[test]
    fn test_upload_options_deserialization() {
        let json = r#"{"filePath":"/tmp/test.mp3","title":"My Recording","folderId":"f1","tagIds":["t1","t2"]}"#;
        let opts: UploadOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.file_path, "/tmp/test.mp3");
        assert_eq!(opts.title, Some("My Recording".to_string()));
        assert_eq!(opts.folder_id, Some("f1".to_string()));
        assert_eq!(
            opts.tag_ids,
            Some(vec!["t1".to_string(), "t2".to_string()])
        );
    }

    #[test]
    fn test_upload_options_minimal() {
        let json = r#"{"filePath":"/tmp/test.mp3"}"#;
        let opts: UploadOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.file_path, "/tmp/test.mp3");
        assert!(opts.title.is_none());
        assert!(opts.folder_id.is_none());
        assert!(opts.tag_ids.is_none());
    }

    #[test]
    fn test_upload_progress_serialization() {
        let progress = UploadProgress {
            phase: "uploading".to_string(),
            bytes_sent: 1024,
            bytes_total: 4096,
            error: None,
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"phase\":\"uploading\""));
        assert!(json.contains("\"bytesSent\":1024"));
        assert!(json.contains("\"bytesTotal\":4096"));
        assert!(!json.contains("error"));
    }

    #[test]
    fn test_upload_progress_with_error() {
        let progress = UploadProgress {
            phase: "error".to_string(),
            bytes_sent: 0,
            bytes_total: 4096,
            error: Some("connection failed".to_string()),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"error\":\"connection failed\""));
    }

    #[test]
    fn test_cancel_flag() {
        reset_cancel();
        assert!(!is_cancelled());
        cancel_upload();
        assert!(is_cancelled());
        reset_cancel();
        assert!(!is_cancelled());
    }

    #[test]
    fn test_server_folder_deserialization() {
        let json = r#"{"id":"f1","name":"Meetings","icon":"briefcase"}"#;
        let folder: ServerFolder = serde_json::from_str(json).unwrap();
        assert_eq!(folder.id, "f1");
        assert_eq!(folder.name, "Meetings");
        assert_eq!(folder.icon, "briefcase");
    }

    #[test]
    fn test_server_tag_deserialization() {
        let json = r#"{"id":"t1","name":"Important"}"#;
        let tag: ServerTag = serde_json::from_str(json).unwrap();
        assert_eq!(tag.id, "t1");
        assert_eq!(tag.name, "Important");
    }
}
