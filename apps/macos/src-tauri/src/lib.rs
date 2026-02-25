pub mod audio;
pub mod config;
pub mod http_client;
pub mod recorder;
pub mod recordings;
pub mod system_audio;
pub mod upload;

pub use audio::AudioDeviceManager;
pub use config::{clear_config, get_input_device, get_input_device_full, get_output_dir, has_config, load_config, save_config, save_input_device, save_output_dir, AppConfig};
pub use recorder::{generate_filename, Recorder, RecorderConfig, RecorderState};
pub use recordings::{
    batch_delete_recordings, default_output_dir, delete_recording, find_cleanable_recordings,
    list_recordings, CleanupFilter, CleanupResult, RecordingInfo,
};
pub use system_audio::{
    check_permission, list_audio_input_devices, AudioInputDeviceInfo, CaptureConfig,
    CaptureError, PermissionStatus, SystemAudioCapture,
};
pub use upload::{cancel_upload, upload_recording, ServerFolder, ServerTag, UploadOptions, UploadProgress, UploadResult};
