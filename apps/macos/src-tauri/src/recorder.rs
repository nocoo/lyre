use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use mp3lame_encoder::{Builder, Encoder, FlushNoGap, MonoPcm};
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
    /// Name of the selected input device (None = use default).
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
            selected_device_name: None,
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

        // Resolve device: by name (with fallback to default if unavailable)
        let device = match &self.config.selected_device_name {
            Some(name) => match device_manager.input_device_by_name(name) {
                Some(d) => d,
                None => {
                    eprintln!(
                        "selected device '{}' not found, falling back to system default",
                        name
                    );
                    device_manager
                        .default_input_device()
                        .ok_or(RecordError::NoDefaultDevice)?
                }
            },
            None => device_manager
                .default_input_device()
                .ok_or(RecordError::NoDefaultDevice)?,
        };

        let device_name = device.name().unwrap_or_else(|_| "unknown".to_string());

        let supported_config = AudioDeviceManager::default_input_config(&device)
            .map_err(|e| RecordError::ConfigError(e.to_string()))?;

        let channels = supported_config.channels();
        let sample_rate = supported_config.sample_rate().0;
        let sample_format = supported_config.sample_format();

        println!(
            "audio device: name={device_name}, channels={channels}, \
             sample_rate={sample_rate}, format={sample_format:?}"
        );

        // Ensure output dir exists
        fs::create_dir_all(&self.config.output_dir)
            .map_err(|e| RecordError::IoError(e.to_string()))?;

        // Generate filename with timestamp
        let filename = generate_filename();
        let output_path = self.config.output_dir.join(&filename);

        // Build MP3 encoder — always mono (voice recording).
        // Multi-channel input is downmixed to mono before encoding.
        let mp3_writer = build_mp3_writer(&output_path, sample_rate)?;
        let writer = Arc::new(Mutex::new(Some(mp3_writer)));

        // Build input stream
        let writer_clone = writer.clone();
        let err_fn = |err: cpal::StreamError| {
            eprintln!("audio stream error: {err}");
        };

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

    /// Select a specific device by name, or None for default.
    pub fn select_device(&mut self, name: Option<String>) {
        self.config.selected_device_name = name;
    }
}

/// Errors that can occur during recording.
#[derive(Debug, Clone)]
pub enum RecordError {
    AlreadyRecording,
    NotRecording,
    #[allow(dead_code)]
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

/// Build an MP3 encoder configured for mono output.
///
/// Multi-channel input is downmixed to mono before encoding, so the encoder
/// is always 1-channel regardless of the capture device.
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

/// Downmix interleaved multi-channel f32 samples to mono by averaging channels.
fn downmix_to_mono_f32(data: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return data.to_vec();
    }
    let ch = channels as usize;
    data.chunks_exact(ch)
        .map(|frame| {
            let sum: f32 = frame.iter().sum();
            (sum / channels as f32).clamp(-1.0, 1.0)
        })
        .collect()
}

/// Encode f32 PCM samples to MP3 (downmixed to mono).
fn encode_samples_f32(writer: &Arc<Mutex<Option<Mp3Writer>>>, data: &[f32], channels: u16) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            let mono = downmix_to_mono_f32(data, channels);
            encode_mono_f32(w, &mono);
        }
    }
}

/// Encode i16 PCM samples to MP3 (downmixed to mono, converted to f32).
fn encode_samples_i16(writer: &Arc<Mutex<Option<Mp3Writer>>>, data: &[i16], channels: u16) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            let f32_data: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
            let mono = downmix_to_mono_f32(&f32_data, channels);
            encode_mono_f32(w, &mono);
        }
    }
}

/// Encode u16 PCM samples to MP3 (downmixed to mono, converted to f32).
fn encode_samples_u16(writer: &Arc<Mutex<Option<Mp3Writer>>>, data: &[u16], channels: u16) {
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            let f32_data: Vec<f32> = data
                .iter()
                .map(|&s| (s as f32 - 32768.0) / 32768.0)
                .collect();
            let mono = downmix_to_mono_f32(&f32_data, channels);
            encode_mono_f32(w, &mono);
        }
    }
}

/// Encode mono f32 samples to MP3 and write to file.
fn encode_mono_f32(w: &mut Mp3Writer, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    let input = MonoPcm(samples);

    let mut mp3_buf = Vec::new();
    mp3_buf.reserve(mp3lame_encoder::max_required_buffer_size(samples.len()));

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
        assert!(recorder.config.selected_device_name.is_none());
        recorder.select_device(Some("Test Mic".to_string()));
        assert_eq!(
            recorder.config.selected_device_name,
            Some("Test Mic".to_string())
        );
        recorder.select_device(None);
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
            selected_device_name: Some("USB Mic".to_string()),
        };
        let recorder = Recorder::new(config);
        assert_eq!(recorder.config.output_dir, PathBuf::from("/custom/path"));
        assert_eq!(
            recorder.config.selected_device_name,
            Some("USB Mic".to_string())
        );
        assert_eq!(recorder.state(), RecorderState::Idle);
    }

    #[test]
    fn test_start_with_unavailable_device_name() {
        let config = RecorderConfig {
            output_dir: PathBuf::from("/tmp/test-recordings"),
            selected_device_name: Some("Nonexistent Device XYZ".to_string()),
        };
        let mut recorder = Recorder::new(config);
        let device_manager = AudioDeviceManager::new();
        // With a nonexistent device name, start() falls back to default device.
        // On machines with audio hardware it will succeed (using default),
        // on CI without audio it will fail with NoDefaultDevice.
        let result = recorder.start(&device_manager);
        if device_manager.default_input_device().is_some() {
            // Has audio hardware: fallback to default should succeed
            assert!(result.is_ok(), "should fall back to default device");
            let _ = recorder.stop();
        } else {
            // No audio hardware: should fail with NoDefaultDevice
            assert!(result.is_err());
        }
    }
}
