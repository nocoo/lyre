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

/// Real-time mixer for two audio streams (system audio + microphone).
///
/// ScreenCaptureKit delivers system audio and microphone as **separate**
/// `CMSampleBuffer` streams.  Simply concatenating them doubles the duration.
/// This mixer accumulates samples from each source into independent buffers,
/// and whenever both have data it mixes them (sample-by-sample average) and
/// flushes the result to the downstream handler.
///
/// When only one source delivers data (e.g. mic permission not granted),
/// the mixer drains that source directly after a configurable timeout
/// (`max_pending_samples`) to avoid unbounded buffering.
struct AudioMixer {
    /// Downstream handler that receives mixed PCM.
    handler: Arc<Mutex<Box<dyn AudioDataHandler>>>,
    /// Pending system audio samples.
    system_buf: Vec<f32>,
    /// Pending microphone samples.
    mic_buf: Vec<f32>,
    /// Maximum samples to buffer before draining a single source.
    /// At 48 kHz mono this is ~100 ms (4800 samples).
    max_pending_samples: usize,
}

impl AudioMixer {
    fn new(handler: Arc<Mutex<Box<dyn AudioDataHandler>>>) -> Self {
        Self {
            handler,
            system_buf: Vec::with_capacity(4800),
            mic_buf: Vec::with_capacity(4800),
            // ~100 ms at 48 kHz — generous enough to absorb scheduling jitter
            // between the two callback queues, short enough to keep latency low.
            max_pending_samples: 4800,
        }
    }

    /// Push system audio samples and attempt to mix + flush.
    fn push_system(&mut self, samples: &[f32]) {
        self.system_buf.extend_from_slice(samples);
        self.try_mix();
    }

    /// Push microphone samples and attempt to mix + flush.
    fn push_mic(&mut self, samples: &[f32]) {
        self.mic_buf.extend_from_slice(samples);
        self.try_mix();
    }

    /// Mix overlapping samples from both buffers and flush to downstream.
    ///
    /// Takes the minimum length of the two buffers, mixes those samples,
    /// and drains them.  If only one buffer has accumulated beyond
    /// `max_pending_samples` (the other source is silent / not delivering),
    /// drain that buffer directly so we don't block indefinitely.
    fn try_mix(&mut self) {
        let overlap = self.system_buf.len().min(self.mic_buf.len());

        if overlap > 0 {
            // Mix overlapping region: simple average, clamped to [-1, 1].
            let mixed: Vec<f32> = self.system_buf[..overlap]
                .iter()
                .zip(&self.mic_buf[..overlap])
                .map(|(&a, &b)| ((a + b) * 0.5).clamp(-1.0, 1.0))
                .collect();

            self.system_buf.drain(..overlap);
            self.mic_buf.drain(..overlap);

            self.emit(&mixed);
            return;
        }

        // Drain whichever single source exceeds the threshold (the other
        // source is presumably not delivering, e.g. no mic permission).
        if self.system_buf.len() >= self.max_pending_samples {
            let drained: Vec<f32> = self.system_buf.drain(..).collect();
            self.emit(&drained);
        } else if self.mic_buf.len() >= self.max_pending_samples {
            let drained: Vec<f32> = self.mic_buf.drain(..).collect();
            self.emit(&drained);
        }
    }

    fn emit(&self, samples: &[f32]) {
        if let Ok(h) = self.handler.lock() {
            h.on_audio_data(samples);
        }
    }
}

/// Output handler that receives CMSampleBuffers and extracts PCM data.
///
/// Each instance is registered for a specific `SCStreamOutputType` and only
/// processes buffers matching that type.  This design is forward-compatible
/// with the `screencapturekit` crate: the current v1.5 has a bug where every
/// buffer is broadcast to ALL registered handlers regardless of their
/// registered output type, so the `expected_type` filter prevents double
/// processing.  If the crate ever fixes this bug, each handler will only
/// receive its own type and the filter becomes a harmless no-op.
///
/// When microphone capture is enabled, samples are routed through an
/// `AudioMixer` that combines system audio + mic in real time.  When only
/// system audio is captured, samples go directly to the downstream handler.
enum OutputTarget {
    /// Direct passthrough — only system audio, no mixing needed.
    Direct(Arc<Mutex<Box<dyn AudioDataHandler>>>),
    /// Two-source mixer — system audio + microphone.
    Mixer(Arc<Mutex<AudioMixer>>),
}

struct AudioOutputHandler {
    /// Where to send extracted PCM samples.
    target: OutputTarget,
    /// Number of channels configured for this stream.
    channels: u32,
    /// The output type this handler is responsible for.
    expected_type: SCStreamOutputType,
}

impl SCStreamOutputTrait for AudioOutputHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        // Only process buffers matching our registered type.
        // See struct-level doc comment for rationale.
        if output_type != self.expected_type {
            return;
        }

        let Some(pcm) = extract_mono_f32_samples(&sample, self.channels) else {
            return;
        };

        match &self.target {
            OutputTarget::Direct(handler) => {
                if let Ok(h) = handler.lock() {
                    h.on_audio_data(&pcm);
                }
            }
            OutputTarget::Mixer(mixer) => {
                if let Ok(mut m) = mixer.lock() {
                    match self.expected_type {
                        SCStreamOutputType::Audio => m.push_system(&pcm),
                        SCStreamOutputType::Microphone => m.push_mic(&pcm),
                        SCStreamOutputType::Screen => {}
                    }
                }
            }
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

    // 5. Create stream and register output handlers.
    //
    // Apple's SCStream requires a separate `addStreamOutput(_:type:)` call for
    // each output type you want to receive.  Without registering for
    // `SCStreamOutputType::Microphone`, the system never delivers mic buffers
    // even when `set_captures_microphone(true)` is set.
    //
    // CRATE BUG (screencapturekit v1.5): The crate's `sample_handler` callback
    // dispatches every buffer to ALL registered handlers, ignoring the output
    // type they were registered for.  To prevent double-processing, each
    // `AudioOutputHandler` carries an `expected_type` field and silently drops
    // buffers that don't match.  This is forward-compatible: if the crate fixes
    // the bug, each handler only receives its own type and the filter is a
    // harmless no-op.
    //
    // When both system audio and microphone are enabled, an `AudioMixer` sits
    // between the two handlers and the downstream `AudioDataHandler`.  The
    // mixer accumulates samples from each source and outputs their average
    // so that the final MP3 has the correct duration (not 2×).
    let handler = Arc::new(Mutex::new(handler));

    let mut stream = SCStream::new(&filter, &stream_config);

    if config.capture_microphone {
        // Two-source mode: route both through AudioMixer
        let mixer = Arc::new(Mutex::new(AudioMixer::new(Arc::clone(&handler))));

        let audio_handler = AudioOutputHandler {
            target: OutputTarget::Mixer(Arc::clone(&mixer)),
            channels: 1,
            expected_type: SCStreamOutputType::Audio,
        };
        stream.add_output_handler(audio_handler, SCStreamOutputType::Audio);

        let mic_handler = AudioOutputHandler {
            target: OutputTarget::Mixer(mixer),
            channels: 1,
            expected_type: SCStreamOutputType::Microphone,
        };
        stream.add_output_handler(mic_handler, SCStreamOutputType::Microphone);
    } else {
        // Single-source mode: direct passthrough, no mixer overhead
        let audio_handler = AudioOutputHandler {
            target: OutputTarget::Direct(handler),
            channels: 1,
            expected_type: SCStreamOutputType::Audio,
        };
        stream.add_output_handler(audio_handler, SCStreamOutputType::Audio);
    }

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
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    // --- AudioMixer tests ---

    /// Test helper: collects samples emitted by the mixer.
    struct CollectingHandler {
        samples: Arc<Mutex<Vec<f32>>>,
        call_count: Arc<AtomicUsize>,
    }

    impl CollectingHandler {
        fn new() -> (Self, Arc<Mutex<Vec<f32>>>, Arc<AtomicUsize>) {
            let samples = Arc::new(Mutex::new(Vec::new()));
            let count = Arc::new(AtomicUsize::new(0));
            (
                Self {
                    samples: Arc::clone(&samples),
                    call_count: Arc::clone(&count),
                },
                samples,
                count,
            )
        }
    }

    impl AudioDataHandler for CollectingHandler {
        fn on_audio_data(&self, data: &[f32]) {
            self.samples.lock().unwrap().extend_from_slice(data);
            self.call_count.fetch_add(1, Ordering::Relaxed);
        }
        fn on_error(&self, _error: String) {}
    }

    #[test]
    fn test_mixer_both_sources_equal_length() {
        let (handler, output, _) = CollectingHandler::new();
        let handler: Arc<Mutex<Box<dyn AudioDataHandler>>> =
            Arc::new(Mutex::new(Box::new(handler)));
        let mut mixer = AudioMixer::new(handler);

        mixer.push_system(&[1.0, 0.5, 0.0]);
        // Nothing emitted yet — mic hasn't delivered
        assert!(output.lock().unwrap().is_empty());

        mixer.push_mic(&[0.0, 0.5, 1.0]);
        // Now both have 3 samples — should mix and emit
        let out = output.lock().unwrap();
        assert_eq!(out.len(), 3);
        assert!((out[0] - 0.5).abs() < f32::EPSILON); // (1.0 + 0.0) / 2
        assert!((out[1] - 0.5).abs() < f32::EPSILON); // (0.5 + 0.5) / 2
        assert!((out[2] - 0.5).abs() < f32::EPSILON); // (0.0 + 1.0) / 2
    }

    #[test]
    fn test_mixer_unequal_lengths() {
        let (handler, output, _) = CollectingHandler::new();
        let handler: Arc<Mutex<Box<dyn AudioDataHandler>>> =
            Arc::new(Mutex::new(Box::new(handler)));
        let mut mixer = AudioMixer::new(handler);

        mixer.push_system(&[0.8, 0.6, 0.4, 0.2]);
        mixer.push_mic(&[0.2, 0.4]);
        // Should mix 2 samples, leaving 2 in system_buf
        let out = output.lock().unwrap();
        assert_eq!(out.len(), 2);
        assert!((out[0] - 0.5).abs() < f32::EPSILON); // (0.8 + 0.2) / 2
        assert!((out[1] - 0.5).abs() < f32::EPSILON); // (0.6 + 0.4) / 2
    }

    #[test]
    fn test_mixer_single_source_drains_at_threshold() {
        let (handler, output, _) = CollectingHandler::new();
        let handler: Arc<Mutex<Box<dyn AudioDataHandler>>> =
            Arc::new(Mutex::new(Box::new(handler)));
        let mut mixer = AudioMixer::new(handler);
        mixer.max_pending_samples = 10; // Lower threshold for testing

        // Push 10 system samples with no mic — should drain
        mixer.push_system(&[0.5; 10]);
        let out = output.lock().unwrap();
        assert_eq!(out.len(), 10);
        assert!(out.iter().all(|&s| (s - 0.5).abs() < f32::EPSILON));
    }

    #[test]
    fn test_mixer_clamps_output() {
        let (handler, output, _) = CollectingHandler::new();
        let handler: Arc<Mutex<Box<dyn AudioDataHandler>>> =
            Arc::new(Mutex::new(Box::new(handler)));
        let mut mixer = AudioMixer::new(handler);

        // Both near max → average should still be clamped
        mixer.push_system(&[1.0, -1.0]);
        mixer.push_mic(&[1.0, -1.0]);
        let out = output.lock().unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0] <= 1.0);
        assert!(out[1] >= -1.0);
    }

    #[test]
    fn test_mixer_preserves_sample_count() {
        // Simulates a 2-second recording at 48kHz with both sources
        // delivering 960-sample buffers (20ms frames).
        let (handler, output, _) = CollectingHandler::new();
        let handler: Arc<Mutex<Box<dyn AudioDataHandler>>> =
            Arc::new(Mutex::new(Box::new(handler)));
        let mut mixer = AudioMixer::new(handler);

        let frame = vec![0.1_f32; 960];
        let frames_per_second = 50; // 48000 / 960
        let total_frames = frames_per_second * 2;

        for _ in 0..total_frames {
            mixer.push_system(&frame);
            mixer.push_mic(&frame);
        }

        let out = output.lock().unwrap();
        // Total output should equal 2 seconds worth of samples (96000),
        // NOT 2× that (which was the bug before the mixer).
        assert_eq!(out.len(), 96000);
    }
}
