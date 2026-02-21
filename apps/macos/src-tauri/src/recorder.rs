use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{SampleFormat, Stream, SupportedStreamConfig};
use hound::{WavSpec, WavWriter};
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::audio::AudioDeviceManager;

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
    /// Index of the selected input device (None = use default).
    pub selected_device_index: Option<usize>,
}

impl Default for RecorderConfig {
    fn default() -> Self {
        let output_dir = dirs::audio_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Music")))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Lyre Recordings");
        Self {
            output_dir,
            selected_device_index: None,
        }
    }
}

/// Core recorder that captures audio from an input device to a WAV file.
///
/// NOTE: `cpal::Stream` is !Send on macOS, so this struct must stay on the
/// thread that created it (typically the main thread). Do not put it in
/// Tauri managed state directly — use interior mutability on the main thread.
pub struct Recorder {
    pub config: RecorderConfig,
    state: RecorderState,
    /// Active cpal stream (kept alive while recording). Not Send.
    active_stream: Option<Stream>,
    /// Path of the file currently being recorded.
    current_file: Option<PathBuf>,
}

impl Recorder {
    pub fn new(config: RecorderConfig) -> Self {
        Self {
            config,
            state: RecorderState::Idle,
            active_stream: None,
            current_file: None,
        }
    }

    pub fn state(&self) -> RecorderState {
        self.state
    }

    /// Start recording. Returns the output file path on success.
    pub fn start(&mut self, device_manager: &AudioDeviceManager) -> Result<PathBuf, RecordError> {
        if self.state == RecorderState::Recording {
            return Err(RecordError::AlreadyRecording);
        }

        // Resolve device
        let device = match self.config.selected_device_index {
            Some(idx) => device_manager
                .input_device_by_index(idx)
                .ok_or(RecordError::DeviceNotFound)?,
            None => device_manager
                .default_input_device()
                .ok_or(RecordError::NoDefaultDevice)?,
        };

        let supported_config = AudioDeviceManager::default_input_config(&device)
            .map_err(|e| RecordError::ConfigError(e.to_string()))?;

        // Ensure output dir exists
        fs::create_dir_all(&self.config.output_dir)
            .map_err(|e| RecordError::IoError(e.to_string()))?;

        // Generate filename with timestamp
        let filename = generate_filename();
        let output_path = self.config.output_dir.join(&filename);

        // Build WAV writer
        let spec = wav_spec_from_config(&supported_config);
        let writer = WavWriter::create(&output_path, spec)
            .map_err(|e| RecordError::IoError(e.to_string()))?;
        let writer = Arc::new(Mutex::new(Some(writer)));

        // Build input stream
        let writer_clone = writer.clone();
        let err_fn = |err: cpal::StreamError| {
            eprintln!("audio stream error: {err}");
        };

        let sample_format = supported_config.sample_format();
        let config = supported_config.into();

        let stream = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _| write_samples_f32(&writer_clone, data),
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _| write_samples_i16(&writer_clone, data),
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _| write_samples_u16(&writer_clone, data),
                err_fn,
                None,
            ),
            _ => return Err(RecordError::UnsupportedFormat(format!("{sample_format:?}"))),
        }
        .map_err(|e| RecordError::StreamError(e.to_string()))?;

        stream
            .play()
            .map_err(|e| RecordError::StreamError(e.to_string()))?;

        self.active_stream = Some(stream);
        self.current_file = Some(output_path.clone());
        self.state = RecorderState::Recording;

        Ok(output_path)
    }

    /// Stop recording. Returns the saved file path.
    pub fn stop(&mut self) -> Result<PathBuf, RecordError> {
        if self.state != RecorderState::Recording {
            return Err(RecordError::NotRecording);
        }

        // Drop the stream to flush and close
        self.active_stream.take();
        self.state = RecorderState::Idle;

        self.current_file
            .take()
            .ok_or(RecordError::IoError("no current file".into()))
    }

    /// Update the output directory.
    pub fn set_output_dir(&mut self, dir: PathBuf) {
        self.config.output_dir = dir;
    }

    /// Select a specific device by index, or None for default.
    pub fn select_device(&mut self, index: Option<usize>) {
        self.config.selected_device_index = index;
    }
}

/// Errors that can occur during recording.
#[derive(Debug, Clone)]
pub enum RecordError {
    AlreadyRecording,
    NotRecording,
    DeviceNotFound,
    NoDefaultDevice,
    ConfigError(String),
    StreamError(String),
    IoError(String),
    UnsupportedFormat(String),
}

impl std::fmt::Display for RecordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRecording => write!(f, "already recording"),
            Self::NotRecording => write!(f, "not recording"),
            Self::DeviceNotFound => write!(f, "audio device not found"),
            Self::NoDefaultDevice => write!(f, "no default input device"),
            Self::ConfigError(e) => write!(f, "config error: {e}"),
            Self::StreamError(e) => write!(f, "stream error: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::UnsupportedFormat(e) => write!(f, "unsupported sample format: {e}"),
        }
    }
}

impl std::error::Error for RecordError {}

// --- Internal helpers ---

pub fn generate_filename() -> String {
    let now = chrono::Local::now();
    format!("recording-{}.wav", now.format("%Y%m%d-%H%M%S"))
}

fn wav_spec_from_config(config: &SupportedStreamConfig) -> WavSpec {
    let sample_format = match config.sample_format() {
        SampleFormat::F32 => hound::SampleFormat::Float,
        _ => hound::SampleFormat::Int,
    };
    let bits_per_sample = match config.sample_format() {
        SampleFormat::F32 => 32,
        SampleFormat::I16 | SampleFormat::U16 => 16,
        _ => 16,
    };
    WavSpec {
        channels: config.channels(),
        sample_rate: config.sample_rate().0,
        bits_per_sample,
        sample_format,
    }
}

fn write_samples_f32(writer: &Arc<Mutex<Option<WavWriter<BufWriter<fs::File>>>>>, data: &[f32]) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            for &sample in data {
                let _ = w.write_sample(sample);
            }
        }
    }
}

fn write_samples_i16(writer: &Arc<Mutex<Option<WavWriter<BufWriter<fs::File>>>>>, data: &[i16]) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            for &sample in data {
                let _ = w.write_sample(sample);
            }
        }
    }
}

fn write_samples_u16(writer: &Arc<Mutex<Option<WavWriter<BufWriter<fs::File>>>>>, data: &[u16]) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            for &sample in data {
                // Convert u16 to i16 for WAV
                let sample_i16 = (sample as i32 - 32768) as i16;
                let _ = w.write_sample(sample_i16);
            }
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
        assert!(config.selected_device_index.is_none());
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
        assert!(recorder.config.selected_device_index.is_none());
        recorder.select_device(Some(2));
        assert_eq!(recorder.config.selected_device_index, Some(2));
        recorder.select_device(None);
        assert!(recorder.config.selected_device_index.is_none());
    }

    #[test]
    fn test_generate_filename() {
        let filename = generate_filename();
        assert!(filename.starts_with("recording-"));
        assert!(filename.ends_with(".wav"));
        assert!(filename.len() > 20); // recording-YYYYMMDD-HHMMSS.wav
    }

    #[test]
    fn test_record_error_display() {
        assert_eq!(
            RecordError::AlreadyRecording.to_string(),
            "already recording"
        );
        assert_eq!(RecordError::NotRecording.to_string(), "not recording");
        assert_eq!(
            RecordError::DeviceNotFound.to_string(),
            "audio device not found"
        );
        assert_eq!(
            RecordError::NoDefaultDevice.to_string(),
            "no default input device"
        );
    }

    #[test]
    fn test_recorder_config_custom() {
        let config = RecorderConfig {
            output_dir: PathBuf::from("/custom/path"),
            selected_device_index: Some(3),
        };
        let recorder = Recorder::new(config);
        assert_eq!(recorder.config.output_dir, PathBuf::from("/custom/path"));
        assert_eq!(recorder.config.selected_device_index, Some(3));
        assert_eq!(recorder.state(), RecorderState::Idle);
    }

    #[test]
    fn test_start_with_invalid_device_index() {
        let config = RecorderConfig {
            output_dir: PathBuf::from("/tmp/test-recordings"),
            selected_device_index: Some(9999),
        };
        let mut recorder = Recorder::new(config);
        let device_manager = AudioDeviceManager::new();
        let result = recorder.start(&device_manager);
        assert!(result.is_err());
        match result.unwrap_err() {
            RecordError::DeviceNotFound => {}
            other => panic!("expected DeviceNotFound, got: {other}"),
        }
    }
}
