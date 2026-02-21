use cpal::traits::{DeviceTrait, HostTrait};
use cpal::Device;

/// Manages audio input device enumeration and selection.
pub struct AudioDeviceManager {
    host: cpal::Host,
}

/// Metadata about an audio input device.
#[derive(Debug, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub index: usize,
    pub is_default: bool,
}

impl Default for AudioDeviceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioDeviceManager {
    pub fn new() -> Self {
        let host = cpal::default_host();
        Self { host }
    }

    /// List all available input devices with metadata.
    pub fn list_input_devices(&self) -> Vec<AudioDeviceInfo> {
        let default_name = self.host.default_input_device().and_then(|d| d.name().ok());

        let devices = match self.host.input_devices() {
            Ok(devices) => devices,
            Err(e) => {
                eprintln!("failed to enumerate input devices: {e}");
                return Vec::new();
            }
        };

        devices
            .enumerate()
            .filter_map(|(index, device)| {
                let name = device.name().ok()?;
                let is_default = default_name.as_deref() == Some(&name);
                Some(AudioDeviceInfo {
                    name,
                    index,
                    is_default,
                })
            })
            .collect()
    }

    /// Get the default input device.
    pub fn default_input_device(&self) -> Option<Device> {
        self.host.default_input_device()
    }

    /// Get an input device by index (as returned by `list_input_devices`).
    pub fn input_device_by_index(&self, index: usize) -> Option<Device> {
        self.host.input_devices().ok()?.nth(index)
    }

    /// Get the default input config for a device.
    pub fn default_input_config(
        device: &Device,
    ) -> Result<cpal::SupportedStreamConfig, cpal::DefaultStreamConfigError> {
        device.default_input_config()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_device_manager_creation() {
        let manager = AudioDeviceManager::new();
        // Should not panic — even if no devices, list returns empty vec
        let devices = manager.list_input_devices();
        // Just verify it returns without panicking
        let _ = devices;
    }

    #[test]
    fn test_device_info_fields() {
        let info = AudioDeviceInfo {
            name: "Test Mic".to_string(),
            index: 0,
            is_default: true,
        };
        assert_eq!(info.name, "Test Mic");
        assert_eq!(info.index, 0);
        assert!(info.is_default);
    }

    #[test]
    fn test_list_devices_default_flag() {
        let manager = AudioDeviceManager::new();
        let devices = manager.list_input_devices();
        // At most one device should be marked default
        let default_count = devices.iter().filter(|d| d.is_default).count();
        assert!(default_count <= 1);
    }

    #[test]
    fn test_input_device_by_invalid_index() {
        let manager = AudioDeviceManager::new();
        // Very large index should return None
        let result = manager.input_device_by_index(99999);
        assert!(result.is_none());
    }
}
