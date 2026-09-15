import CoreAudio
import Foundation

/// Resolve the input selected in macOS Sound settings using the same UIDs
/// handed to ScreenCaptureKit. AVFoundation's default can lag route changes.
enum SystemAudioInputs {
    static func defaultDeviceID() -> String? {
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard let device = integerProperty(system, selector: kAudioHardwarePropertyDefaultInputDevice),
              device != kAudioObjectUnknown else { return nil }
        return stringProperty(device, selector: kAudioDevicePropertyDeviceUID)
    }

    static func devices() -> [AudioInputDevice] {
        let system = AudioObjectID(kAudioObjectSystemObject)
        var property = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &property, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { device in
            var streams = address(kAudioDevicePropertyStreams, scope: kAudioObjectPropertyScopeInput)
            var streamSize: UInt32 = 0
            guard integerProperty(device, selector: kAudioDevicePropertyDeviceIsAlive) == 1,
                  AudioObjectGetPropertyDataSize(device, &streams, 0, nil, &streamSize) == noErr, streamSize > 0,
                  let uid = stringProperty(device, selector: kAudioDevicePropertyDeviceUID),
                  let name = stringProperty(device, selector: kAudioObjectPropertyName) else { return nil }
            return AudioInputDevice(id: uid, name: name)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    static func address(
        _ selector: AudioObjectPropertySelector,
        scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
    ) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func integerProperty(_ object: AudioObjectID, selector: AudioObjectPropertySelector) -> UInt32? {
        var property = address(selector)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }

    private static func stringProperty(_ object: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
        var property = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }
}
