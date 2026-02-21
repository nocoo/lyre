use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{SampleFormat, Stream, SupportedStreamConfig};
use mp3lame_encoder::{Builder, Encoder, FlushNoGap, InterleavedPcm};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
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

/// Shared MP3 writer state passed into the audio stream callback.
struct Mp3Writer {
    encoder: Encoder,
    file: BufWriter<File>,
}

/// Core recorder that captures audio from an input device to an MP3 file.
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
    /// Shared MP3 writer for flushing on stop.
    mp3_writer: Option<Arc<Mutex<Option<Mp3Writer>>>>,
}

impl Recorder {
    pub fn new(config: RecorderConfig) -> Self {
        Self {
            config,
            state: RecorderState::Idle,
            active_stream: None,
            current_file: None,
            mp3_writer: None,
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

        // Build MP3 encoder
        let mp3_writer = build_mp3_writer(&output_path, &supported_config)?;
        let writer = Arc::new(Mutex::new(Some(mp3_writer)));

        // Build input stream
        let writer_clone = writer.clone();
        let err_fn = |err: cpal::StreamError| {
            eprintln!("audio stream error: {err}");
        };

        let channels = supported_config.channels();
        let sample_format = supported_config.sample_format();
        let config = supported_config.into();

        let stream = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _| encode_samples_f32(&writer_clone, data, channels),
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _| encode_samples_i16(&writer_clone, data, channels),
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _| encode_samples_u16(&writer_clone, data, channels),
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
        self.mp3_writer = Some(writer);
        self.state = RecorderState::Recording;

        Ok(output_path)
    }

    /// Stop recording. Returns the saved file path.
    pub fn stop(&mut self) -> Result<PathBuf, RecordError> {
        if self.state != RecorderState::Recording {
            return Err(RecordError::NotRecording);
        }

        // Drop the stream first to stop audio callbacks
        self.active_stream.take();

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
    EncoderError(String),
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

fn build_mp3_writer(
    path: &PathBuf,
    config: &SupportedStreamConfig,
) -> Result<Mp3Writer, RecordError> {
    let channels = config.channels();
    let sample_rate = config.sample_rate().0;

    let mut builder = Builder::new()
        .ok_or_else(|| RecordError::EncoderError("failed to create LAME builder".into()))?;
    builder
        .set_num_channels(channels as u8)
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

/// Encode interleaved f32 PCM samples to MP3 and write to file.
fn encode_samples_f32(writer: &Arc<Mutex<Option<Mp3Writer>>>, data: &[f32], channels: u16) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            // Convert f32 [-1.0, 1.0] to i16 for LAME
            let samples_i16: Vec<i16> = data
                .iter()
                .map(|&s| {
                    let clamped = s.clamp(-1.0, 1.0);
                    (clamped * i16::MAX as f32) as i16
                })
                .collect();
            encode_and_write(w, &samples_i16, channels);
        }
    }
}

/// Encode interleaved i16 PCM samples to MP3 and write to file.
fn encode_samples_i16(writer: &Arc<Mutex<Option<Mp3Writer>>>, data: &[i16], channels: u16) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            encode_and_write(w, data, channels);
        }
    }
}

/// Encode interleaved u16 PCM samples to MP3 and write to file.
fn encode_samples_u16(writer: &Arc<Mutex<Option<Mp3Writer>>>, data: &[u16], channels: u16) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            let samples_i16: Vec<i16> = data.iter().map(|&s| (s as i32 - 32768) as i16).collect();
            encode_and_write(w, &samples_i16, channels);
        }
    }
}

/// Encode a chunk of interleaved i16 samples and write MP3 bytes to file.
fn encode_and_write(w: &mut Mp3Writer, samples: &[i16], channels: u16) {
    // Ensure sample count is a multiple of channel count
    let num_samples = samples.len() - (samples.len() % channels as usize);
    if num_samples == 0 {
        return;
    }
    let input = InterleavedPcm(&samples[..num_samples]);

    let num_frames = num_samples / channels as usize;
    let mut mp3_buf = Vec::new();
    mp3_buf.reserve(mp3lame_encoder::max_required_buffer_size(num_frames));

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
            RecordError::DeviceNotFound.to_string(),
            "audio device not found"
        );
        assert_eq!(
            RecordError::NoDefaultDevice.to_string(),
            "no default input device"
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
