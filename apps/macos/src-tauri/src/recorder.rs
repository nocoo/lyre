use mp3lame_encoder::{Builder, Encoder, FlushNoGap, MonoPcm};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::system_audio::{CaptureConfig, CaptureError, ClosureAudioHandler, SystemAudioCapture};

/// Recording state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecorderState {
    Idle,
    Recording,
}

/// Configuration for the recorder.
#[derive(Debug, Clone)]
pub struct RecorderConfig {
    /// Directory where recordings are saved.
    pub output_dir: PathBuf,
    /// ScreenCaptureKit microphone device ID (None = system default).
    pub selected_device_id: Option<String>,
    /// Human-readable device name, used for display and config persistence.
    pub selected_device_name: Option<String>,
}

impl Default for RecorderConfig {
    fn default() -> Self {
        let output_dir = dirs::audio_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Music")))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Lyre Recordings");
        Self {
            output_dir,
            selected_device_id: None,
            selected_device_name: None,
        }
    }
}

/// Shared MP3 writer state passed into the audio stream callback.
struct Mp3Writer {
    encoder: Encoder,
    file: BufWriter<File>,
}

/// Core recorder that captures system audio + microphone via ScreenCaptureKit
/// and encodes to MP3 in real time.
///
/// NOTE: `SystemAudioCapture` wraps an `SCStream` which is !Send on macOS.
/// The recorder must stay on the thread that created it (main thread).
pub struct Recorder {
    pub config: RecorderConfig,
    state: RecorderState,
    /// Active ScreenCaptureKit capture session.
    active_capture: Option<SystemAudioCapture>,
    /// Path of the file currently being recorded.
    current_file: Option<PathBuf>,
    /// Shared MP3 writer for flushing on stop.
    mp3_writer: Option<Arc<Mutex<Option<Mp3Writer>>>>,
}

impl Recorder {
    pub fn new(config: RecorderConfig) -> Self {
        Self {
            config,
            state: RecorderState::Idle,
            active_capture: None,
            current_file: None,
            mp3_writer: None,
        }
    }

    pub fn state(&self) -> RecorderState {
        self.state
    }

    /// Start recording. Returns the output file path on success.
    ///
    /// Captures both system audio (meeting participants) and microphone
    /// via ScreenCaptureKit (macOS 15.0+).
    pub fn start(&mut self) -> Result<PathBuf, RecordError> {
        if self.state == RecorderState::Recording {
            return Err(RecordError::AlreadyRecording);
        }

        // Ensure output dir exists
        fs::create_dir_all(&self.config.output_dir)
            .map_err(|e| RecordError::IoError(e.to_string()))?;

        // Generate filename with timestamp
        let filename = generate_filename();
        let output_path = self.config.output_dir.join(&filename);

        // Build the capture config
        let capture_config = CaptureConfig {
            sample_rate: 48000,
            capture_system_audio: true,
            capture_microphone: true,
            microphone_device_id: self.config.selected_device_id.clone(),
        };

        // Build MP3 encoder — mono 48kHz to match ScreenCaptureKit output.
        let mp3_writer = build_mp3_writer(&output_path, capture_config.sample_rate)?;
        let writer = Arc::new(Mutex::new(Some(mp3_writer)));

        // Wire ScreenCaptureKit PCM output into the MP3 encoder.
        let writer_clone = writer.clone();
        let handler = ClosureAudioHandler::new(move |samples: &[f32]| {
            if let Ok(mut guard) = writer_clone.lock() {
                if let Some(ref mut w) = *guard {
                    encode_mono_f32(w, samples);
                }
            }
        });

        // Start capture
        let capture = crate::system_audio::start_capture(&capture_config, Box::new(handler))
            .map_err(|e| match e {
                CaptureError::PermissionDenied(msg) => RecordError::PermissionDenied(msg),
                CaptureError::NoDisplay => {
                    RecordError::CaptureError("no display found".to_string())
                }
                CaptureError::StartFailed(msg) => RecordError::CaptureError(msg),
                CaptureError::StopFailed(msg) => RecordError::CaptureError(msg),
            })?;

        println!(
            "recording started: system_audio+mic, sample_rate=48000, device={:?}",
            self.config
                .selected_device_name
                .as_deref()
                .unwrap_or("auto")
        );

        self.active_capture = Some(capture);
        self.current_file = Some(output_path.clone());
        self.mp3_writer = Some(writer);
        self.state = RecorderState::Recording;

        Ok(output_path)
    }

    /// Stop recording. Returns the saved file path.
    pub fn stop(&mut self) -> Result<PathBuf, RecordError> {
        if self.state != RecorderState::Recording {
            return Err(RecordError::NotRecording);
        }

        // Stop the capture first to stop audio callbacks
        if let Some(capture) = self.active_capture.take() {
            if let Err(e) = capture.stop() {
                eprintln!("warning: failed to stop capture cleanly: {e}");
            }
        }

        // Flush the MP3 encoder and close the file
        if let Some(writer_arc) = self.mp3_writer.take() {
            if let Ok(mut guard) = writer_arc.lock() {
                if let Some(mut w) = guard.take() {
                    let mut flush_buf =
                        Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(0));
                    if let Ok(flush_size) = w
                        .encoder
                        .flush::<FlushNoGap>(flush_buf.spare_capacity_mut())
                    {
                        unsafe { flush_buf.set_len(flush_size) };
                        let _ = w.file.write_all(&flush_buf);
                    }
                    let _ = w.file.flush();
                }
            }
        }

        self.state = RecorderState::Idle;

        self.current_file
            .take()
            .ok_or(RecordError::IoError("no current file".into()))
    }

    /// Update the output directory.
    pub fn set_output_dir(&mut self, dir: PathBuf) {
        self.config.output_dir = dir;
    }

    /// Select a specific microphone device by ID and name, or None for default.
    pub fn select_device(&mut self, id: Option<String>, name: Option<String>) {
        self.config.selected_device_id = id;
        self.config.selected_device_name = name;
    }
}

/// Errors that can occur during recording.
#[derive(Debug, Clone)]
pub enum RecordError {
    AlreadyRecording,
    NotRecording,
    PermissionDenied(String),
    CaptureError(String),
    IoError(String),
    EncoderError(String),
}

impl std::fmt::Display for RecordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRecording => write!(f, "already recording"),
            Self::NotRecording => write!(f, "not recording"),
            Self::PermissionDenied(e) => write!(f, "permission denied: {e}"),
            Self::CaptureError(e) => write!(f, "capture error: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::EncoderError(e) => write!(f, "encoder error: {e}"),
        }
    }
}

impl std::error::Error for RecordError {}

// --- Internal helpers ---

pub fn generate_filename() -> String {
    let now = chrono::Local::now();
    format!("recording-{}.mp3", now.format("%Y%m%d-%H%M%S"))
}

/// Build an MP3 encoder configured for mono output at the given sample rate.
fn build_mp3_writer(path: &PathBuf, sample_rate: u32) -> Result<Mp3Writer, RecordError> {
    let mut builder = Builder::new()
        .ok_or_else(|| RecordError::EncoderError("failed to create LAME builder".into()))?;
    builder
        .set_num_channels(1)
        .map_err(|e| RecordError::EncoderError(format!("{e:?}")))?;
    builder
        .set_sample_rate(sample_rate)
        .map_err(|e| RecordError::EncoderError(format!("{e:?}")))?;
    builder
        .set_brate(mp3lame_encoder::Bitrate::Kbps192)
        .map_err(|e| RecordError::EncoderError(format!("{e:?}")))?;
    builder
        .set_quality(mp3lame_encoder::Quality::Best)
        .map_err(|e| RecordError::EncoderError(format!("{e:?}")))?;

    let encoder = builder
        .build()
        .map_err(|e| RecordError::EncoderError(format!("{e:?}")))?;

    let file = File::create(path).map_err(|e| RecordError::IoError(e.to_string()))?;
    let file = BufWriter::new(file);

    Ok(Mp3Writer { encoder, file })
}

/// Encode mono f32 samples to MP3 and write to file.
///
/// Sanitizes input: NaN/Inf are replaced with 0.0 and values are clamped
/// to [-1.0, 1.0] to prevent LAME assertion failures in `calc_energy`.
fn encode_mono_f32(w: &mut Mp3Writer, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }

    // Sanitize: LAME's psymodel asserts energy >= 0, which fails on NaN/Inf.
    let clean: Vec<f32> = samples
        .iter()
        .map(|&s| {
            if s.is_finite() {
                s.clamp(-1.0, 1.0)
            } else {
                0.0
            }
        })
        .collect();
    let input = MonoPcm(&clean);

    let mut mp3_buf = Vec::new();
    mp3_buf.reserve(mp3lame_encoder::max_required_buffer_size(clean.len()));

    match w.encoder.encode(input, mp3_buf.spare_capacity_mut()) {
        Ok(encoded_size) => {
            unsafe { mp3_buf.set_len(encoded_size) };
            let _ = w.file.write_all(&mp3_buf);
        }
        Err(e) => {
            eprintln!("mp3 encode error: {e:?}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RecorderConfig::default();
        assert!(config
            .output_dir
            .to_string_lossy()
            .contains("Lyre Recordings"));
        assert!(config.selected_device_id.is_none());
        assert!(config.selected_device_name.is_none());
    }

    #[test]
    fn test_recorder_initial_state() {
        let recorder = Recorder::new(RecorderConfig::default());
        assert_eq!(recorder.state(), RecorderState::Idle);
    }

    #[test]
    fn test_stop_when_not_recording() {
        let mut recorder = Recorder::new(RecorderConfig::default());
        let result = recorder.stop();
        assert!(result.is_err());
        match result.unwrap_err() {
            RecordError::NotRecording => {}
            other => panic!("expected NotRecording, got: {other}"),
        }
    }

    #[test]
    fn test_set_output_dir() {
        let mut recorder = Recorder::new(RecorderConfig::default());
        let new_dir = PathBuf::from("/tmp/test-recordings");
        recorder.set_output_dir(new_dir.clone());
        assert_eq!(recorder.config.output_dir, new_dir);
    }

    #[test]
    fn test_select_device() {
        let mut recorder = Recorder::new(RecorderConfig::default());
        assert!(recorder.config.selected_device_id.is_none());
        assert!(recorder.config.selected_device_name.is_none());
        recorder.select_device(Some("device-123".to_string()), Some("USB Mic".to_string()));
        assert_eq!(
            recorder.config.selected_device_id,
            Some("device-123".to_string())
        );
        assert_eq!(
            recorder.config.selected_device_name,
            Some("USB Mic".to_string())
        );
        recorder.select_device(None, None);
        assert!(recorder.config.selected_device_id.is_none());
        assert!(recorder.config.selected_device_name.is_none());
    }

    #[test]
    fn test_generate_filename() {
        let filename = generate_filename();
        assert!(filename.starts_with("recording-"));
        assert!(filename.ends_with(".mp3"));
        assert!(filename.len() > 20); // recording-YYYYMMDD-HHMMSS.mp3
    }

    #[test]
    fn test_record_error_display() {
        assert_eq!(
            RecordError::AlreadyRecording.to_string(),
            "already recording"
        );
        assert_eq!(RecordError::NotRecording.to_string(), "not recording");
        assert_eq!(
            RecordError::PermissionDenied("test".into()).to_string(),
            "permission denied: test"
        );
        assert_eq!(
            RecordError::CaptureError("test".into()).to_string(),
            "capture error: test"
        );
        assert_eq!(
            RecordError::EncoderError("test".into()).to_string(),
            "encoder error: test"
        );
    }

    #[test]
    fn test_recorder_config_custom() {
        let config = RecorderConfig {
            output_dir: PathBuf::from("/custom/path"),
            selected_device_id: Some("device-456".to_string()),
            selected_device_name: Some("USB Mic".to_string()),
        };
        let recorder = Recorder::new(config);
        assert_eq!(recorder.config.output_dir, PathBuf::from("/custom/path"));
        assert_eq!(
            recorder.config.selected_device_id,
            Some("device-456".to_string())
        );
        assert_eq!(
            recorder.config.selected_device_name,
            Some("USB Mic".to_string())
        );
        assert_eq!(recorder.state(), RecorderState::Idle);
    }
}
