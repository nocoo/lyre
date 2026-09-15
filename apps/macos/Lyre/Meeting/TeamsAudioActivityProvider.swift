import CoreAudio
import Foundation

struct TeamsAudioActivity: Equatable {
    let input: Bool
    let output: Bool
    var isDuplex: Bool { input && output }
    var isRunning: Bool { input || output }
}

@MainActor
protocol TeamsAudioActivityProviding {
    /// nil means the query failed, not that a call ended.
    func activity(for bundleIDs: Set<String>) -> TeamsAudioActivity?
}

/// CoreAudio process properties require no capture or additional permission.
/// Two-way I/O is a stronger start signal than a microphone preview alone.
@MainActor
final class CoreAudioTeamsAudioActivityProvider: TeamsAudioActivityProviding {
    func activity(for bundleIDs: Set<String>) -> TeamsAudioActivity? {
        guard let ids = Self.processObjectIDs() else { return nil }
        var input = false
        var output = false
        var uncertain = false
        for objectID in ids {
            guard let bundleID = Self.bundleID(of: objectID) else { uncertain = true; continue }
            guard bundleIDs.contains(bundleID) else { continue }
            guard let readsInput = Self.isRunning(objectID, selector: kAudioProcessPropertyIsRunningInput),
                  let writesOutput = Self.isRunning(objectID, selector: kAudioProcessPropertyIsRunningOutput)
            else { uncertain = true; continue }
            input = input || readsInput
            output = output || writesOutput
            if input && output { return TeamsAudioActivity(input: true, output: true) }
        }
        return uncertain ? nil : TeamsAudioActivity(input: input, output: output)
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func processObjectIDs() -> [AudioObjectID]? {
        var property = address(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr else { return nil }
        guard size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &property, 0, nil, &size, &ids) == noErr else { return nil }
        return ids.filter { $0 != kAudioObjectUnknown }
    }

    private static func bundleID(of objectID: AudioObjectID) -> String? {
        var property = address(kAudioProcessPropertyBundleID)
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var value: Unmanaged<CFString>?
        guard AudioObjectGetPropertyData(objectID, &property, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }

    // swiftlint:disable:next discouraged_optional_boolean
    private static func isRunning(_ objectID: AudioObjectID, selector: AudioObjectPropertySelector) -> Bool? {
        var property = address(selector)
        var size = UInt32(MemoryLayout<UInt32>.size)
        var value: UInt32 = 0
        guard AudioObjectGetPropertyData(objectID, &property, 0, nil, &size, &value) == noErr else { return nil }
        return value != 0
    }
}
