//! System audio capture via ScreenCaptureKit.
//!
//! Uses macOS 15.0+ APIs to capture both system audio and microphone input
//! in a single stream, eliminating the need for separate cpal-based capture.
//!
//! # Permission
//!
//! ScreenCaptureKit requires "Screen & System Audio Recording" permission
//! in System Settings > Privacy & Security. The permission check is done
//! by attempting `SCShareableContent::get()` — if it fails, the user has
//! not granted permission.

use screencapturekit::prelude::*;
use screencapturekit::stream::configuration::SCPresenterOverlayAlertSetting;
use std::sync::{Arc, Mutex};

/// Permission status for ScreenCaptureKit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    /// Permission granted — capture is allowed.
    Granted,
    /// Permission denied or not yet requested.
    Denied,
}

/// Check whether the app has ScreenCaptureKit permission.
///
/// This attempts `SCShareableContent::get()`, which fails if the user
/// has not granted "Screen & System Audio Recording" permission.
pub fn check_permission() -> PermissionStatus {
    match SCShareableContent::get() {
        Ok(_) => PermissionStatus::Granted,
        Err(_) => PermissionStatus::Denied,
    }
}

/// Information about an audio input device (from ScreenCaptureKit).
#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioInputDeviceInfo {
    pub id: String,
    pub name: String,
}

/// List available audio input devices via ScreenCaptureKit.
pub fn list_audio_input_devices() -> Vec<AudioInputDeviceInfo> {
    screencapturekit::audio_devices::AudioInputDevice::list()
        .into_iter()
        .map(|d| AudioInputDeviceInfo {
            id: d.id,
            name: d.name,
        })
        .collect()
}

/// Callback trait for receiving mixed audio PCM data.
///
/// The handler receives interleaved f32 PCM mono samples at the
/// configured sample rate (typically 48000 Hz).
pub trait AudioDataHandler: Send + 'static {
    fn on_audio_data(&self, samples: &[f32]);
    #[allow(dead_code)]
    fn on_error(&self, error: String);
}

/// Concrete handler that feeds samples into a shared writer via closure.
pub struct ClosureAudioHandler<F: Fn(&[f32]) + Send + 'static> {
    handler: F,
}

impl<F: Fn(&[f32]) + Send + 'static> ClosureAudioHandler<F> {
    pub fn new(handler: F) -> Self {
        Self { handler }
    }
}

impl<F: Fn(&[f32]) + Send + 'static> AudioDataHandler for ClosureAudioHandler<F> {
    fn on_audio_data(&self, samples: &[f32]) {
        (self.handler)(samples);
    }

    fn on_error(&self, error: String) {
        eprintln!("system audio error: {error}");
    }
}

/// Configuration for system audio capture.
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    /// Sample rate in Hz (default: 48000).
    pub sample_rate: u32,
    /// Whether to capture system audio (default: true).
    pub capture_system_audio: bool,
    /// Whether to capture microphone (default: true).
    pub capture_microphone: bool,
    /// Specific microphone device ID. None = system default.
    pub microphone_device_id: Option<String>,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            capture_system_audio: true,
            capture_microphone: true,
            microphone_device_id: None,
        }
    }
}

/// Active system audio capture session.
///
/// Wraps an `SCStream` that captures system audio and/or microphone.
/// Audio data is delivered as mono f32 PCM via the provided handler.
///
/// Drop this struct to stop capture.
pub struct SystemAudioCapture {
    stream: SCStream,
}

/// Output handler that receives CMSampleBuffers and extracts PCM data.
struct AudioOutputHandler {
    /// Shared handler for delivering PCM data to the recorder.
    handler: Arc<Mutex<Box<dyn AudioDataHandler>>>,
    /// Number of channels configured for this stream.
    channels: u32,
}

impl SCStreamOutputTrait for AudioOutputHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        match output_type {
            SCStreamOutputType::Audio | SCStreamOutputType::Microphone => {
                if let Some(pcm) = extract_mono_f32_samples(&sample, self.channels) {
                    if let Ok(handler) = self.handler.lock() {
                        handler.on_audio_data(&pcm);
                    }
                }
            }
            // Ignore video frames — we only care about audio.
            SCStreamOutputType::Screen => {}
        }
    }
}

/// Start system audio capture.
///
/// Returns a `SystemAudioCapture` handle. The capture runs until the
/// handle is dropped or `stop()` is called.
pub fn start_capture(
    config: &CaptureConfig,
    handler: Box<dyn AudioDataHandler>,
) -> Result<SystemAudioCapture, CaptureError> {
    // 1. Get shareable content (also serves as permission check)
    let content = SCShareableContent::get().map_err(|e| {
        CaptureError::PermissionDenied(format!(
            "screen capture permission denied or unavailable: {e}"
        ))
    })?;

    // 2. Get the first display for the content filter.
    //    Even for audio-only capture, ScreenCaptureKit requires a display filter.
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or(CaptureError::NoDisplay)?;

    // 3. Build content filter
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();

    // 4. Configure stream — audio-only, no video
    let mut stream_config = SCStreamConfiguration::new()
        // Minimal video config (required but not used)
        .with_width(2)
        .with_height(2)
        .with_minimum_frame_interval(&CMTime::new(1, 1)); // 1 FPS minimum

    // System audio
    if config.capture_system_audio {
        stream_config = stream_config
            .with_captures_audio(true)
            .with_sample_rate(config.sample_rate as i32)
            .with_channel_count(1); // Mono for voice recording
    }

    // Microphone (macOS 15.0+)
    if config.capture_microphone {
        stream_config.set_captures_microphone(true);

        if let Some(ref device_id) = config.microphone_device_id {
            stream_config.set_microphone_capture_device_id(device_id);
        }
    }

    // Suppress presenter overlay privacy alert
    stream_config
        .set_presenter_overlay_privacy_alert_setting(SCPresenterOverlayAlertSetting::Never);

    // 5. Create stream and add a SINGLE output handler.
    //
    // IMPORTANT: The `screencapturekit` crate (v1.5) dispatches every sample
    // buffer to ALL registered handlers regardless of their registered output
    // type.  If we registered separate handlers for Audio and Microphone, each
    // buffer would be delivered twice (once per handler), doubling the encoded
    // data and producing an MP3 with 2× the expected duration.  We therefore
    // register one handler on `SCStreamOutputType::Audio` and let
    // `did_output_sample_buffer` handle both Audio and Microphone types.
    let handler = Arc::new(Mutex::new(handler));

    let output_handler = AudioOutputHandler {
        handler,
        channels: 1, // We configured mono
    };

    let mut stream = SCStream::new(&filter, &stream_config);
    stream.add_output_handler(output_handler, SCStreamOutputType::Audio);

    // 6. Start capture
    stream
        .start_capture()
        .map_err(|e| CaptureError::StartFailed(format!("{e}")))?;

    Ok(SystemAudioCapture { stream })
}

impl SystemAudioCapture {
    /// Stop the capture.
    pub fn stop(self) -> Result<(), CaptureError> {
        self.stream
            .stop_capture()
            .map_err(|e| CaptureError::StopFailed(format!("{e}")))
    }
}

/// Extract mono f32 PCM samples from a CMSampleBuffer.
///
/// ScreenCaptureKit delivers audio as interleaved PCM in `AudioBufferList`.
/// We extract the raw bytes, reinterpret as f32, and downmix to mono if needed.
fn extract_mono_f32_samples(sample: &CMSampleBuffer, expected_channels: u32) -> Option<Vec<f32>> {
    let buffer_list = sample.audio_buffer_list()?;

    let mut all_samples: Vec<f32> = Vec::new();

    for buf in buffer_list.iter() {
        let data = buf.data();
        if data.is_empty() {
            continue;
        }

        let channels = buf.number_channels;

        // Reinterpret raw bytes as f32 samples
        // Safety: ScreenCaptureKit outputs 32-bit float PCM
        let (prefix, f32_data, suffix) = unsafe { data.align_to::<f32>() };
        if !prefix.is_empty() || !suffix.is_empty() {
            // Data is not properly aligned — skip this buffer
            eprintln!("audio buffer alignment issue, skipping");
            continue;
        }

        if channels <= 1 || expected_channels == 1 {
            // Already mono or configured for mono
            all_samples.extend_from_slice(f32_data);
        } else {
            // Downmix interleaved multi-channel to mono
            let ch = channels as usize;
            for frame in f32_data.chunks_exact(ch) {
                let sum: f32 = frame.iter().sum();
                all_samples.push((sum / channels as f32).clamp(-1.0, 1.0));
            }
        }
    }

    if all_samples.is_empty() {
        None
    } else {
        Some(all_samples)
    }
}

/// Errors from system audio capture.
#[derive(Debug, Clone)]
pub enum CaptureError {
    PermissionDenied(String),
    NoDisplay,
    StartFailed(String),
    StopFailed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PermissionDenied(e) => write!(f, "permission denied: {e}"),
            Self::NoDisplay => write!(f, "no display found"),
            Self::StartFailed(e) => write!(f, "failed to start capture: {e}"),
            Self::StopFailed(e) => write!(f, "failed to stop capture: {e}"),
        }
    }
}

impl std::error::Error for CaptureError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capture_config_default() {
        let config = CaptureConfig::default();
        assert_eq!(config.sample_rate, 48000);
        assert!(config.capture_system_audio);
        assert!(config.capture_microphone);
        assert!(config.microphone_device_id.is_none());
    }

    #[test]
    fn test_capture_error_display() {
        assert_eq!(CaptureError::NoDisplay.to_string(), "no display found");
        assert_eq!(
            CaptureError::PermissionDenied("test".into()).to_string(),
            "permission denied: test"
        );
        assert_eq!(
            CaptureError::StartFailed("test".into()).to_string(),
            "failed to start capture: test"
        );
        assert_eq!(
            CaptureError::StopFailed("test".into()).to_string(),
            "failed to stop capture: test"
        );
    }

    #[test]
    fn test_permission_status_serialize() {
        let granted = serde_json::to_string(&PermissionStatus::Granted).unwrap();
        assert_eq!(granted, "\"granted\"");
        let denied = serde_json::to_string(&PermissionStatus::Denied).unwrap();
        assert_eq!(denied, "\"denied\"");
    }

    #[test]
    fn test_audio_input_device_info_serialize() {
        let info = AudioInputDeviceInfo {
            id: "test-id".to_string(),
            name: "Test Mic".to_string(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["id"], "test-id");
        assert_eq!(json["name"], "Test Mic");
    }

    #[test]
    fn test_check_permission() {
        // On CI without screen recording permission, this returns Denied.
        // On developer machines with permission, it returns Granted.
        // Either way, it should not panic.
        let status = check_permission();
        assert!(status == PermissionStatus::Granted || status == PermissionStatus::Denied);
    }

    #[test]
    fn test_list_audio_devices() {
        // Should not panic even if no devices available
        let devices = list_audio_input_devices();
        // On machines with audio hardware, we expect at least one device
        // On CI, it may be empty
        for device in &devices {
            assert!(!device.id.is_empty());
            assert!(!device.name.is_empty());
        }
    }
}
