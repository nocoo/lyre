import CoreAudio
import Foundation
import os

// The `Bool?` tri-state (nil = "cannot tell") is intentional throughout this
// file. It lets callers distinguish "definitely no Teams process holds the
// mic" from "we could not enumerate the process list". The watcher
// (`TeamsMeetingWatcher.checkTeamsWindows`) treats both `false` and `nil`
// the same way at the top level: fall through to the v1.3 window heuristic
// as the fallback signal. Suppress the discouraged_optional_boolean rule
// file-wide so this contract is not buried under per-declaration exemptions.
// swiftlint:disable discouraged_optional_boolean

/// Test seam: "is any process with a bundle ID in `bundleIDs` currently
/// reading from the microphone?" Returns nil when the query itself failed
/// (missing macOS version, CoreAudio blip) so the caller can distinguish
/// "no, definitely not" from "cannot tell".
@MainActor
protocol TeamsAudioActivityProviding {
    func isBundleUsingInput(anyOf bundleIDs: Set<String>) -> Bool?
}

/// CoreAudio-backed check for `kAudioProcessPropertyIsRunningInput` filtered
/// to a bundle-ID whitelist. Requires macOS 14.4+ (`kAudioProcessProperty*`
/// selectors were added in that release). Lyre already targets macOS 15,
/// so the availability gate below is a code-review anchor rather than a
/// production branch.
///
/// **Why this signal**: the industry-wide pattern for "is user in a meeting?"
/// on macOS. Zero permission (reading process properties is unprivileged —
/// only *capturing* through a process tap needs the mic entitlement), zero
/// title parsing, zero window enumeration, no Space semantics, no polling
/// necessary (this file exposes only the polled read; event-driven listener
/// is a future step layered on top). Reference implementations:
/// `moona3k/macparakeet` and `BasedHardware/omi`.
@MainActor
final class CoreAudioTeamsAudioActivityProvider: TeamsAudioActivityProviding {
    private static let logger = Logger(
        subsystem: Constants.subsystem,
        category: "TeamsAudioActivityProvider"
    )

    /// Returns true if any live audio process in the system currently has
    /// `IsRunningInput == true` and its bundle ID is in `bundleIDs`.
    /// Returns false when no such process is holding the mic. Returns nil
    /// only if the process list itself could not be enumerated (missing
    /// macOS version, CoreAudio blip). The watcher treats nil the same as
    /// false at the top of `checkTeamsWindows` — both fall through to the
    /// v1.3 window heuristic fallback, so a transient CoreAudio failure
    /// never in itself flips the debouncer.
    func isBundleUsingInput(anyOf bundleIDs: Set<String>) -> Bool? {
        guard #available(macOS 14.4, *) else {
            // macOS < 14.4 lacks kAudioProcessPropertyIsRunningInput.
            // Lyre targets 15+, so the else branch is unreachable in prod;
            // return nil so tests can pin the availability gate explicitly.
            return nil
        }
        guard let ids = Self.processObjectIDs() else { return nil }
        for objectID in ids {
            guard let bid = Self.bundleID(of: objectID),
                  bundleIDs.contains(bid) else { continue }
            if Self.isRunningInput(of: objectID) == true {
                return true
            }
        }
        return false
    }

    // MARK: - CoreAudio helpers (nonisolated because none touch actor state)

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    @available(macOS 14.4, *)
    private static func processObjectIDs() -> [AudioObjectID]? {
        var addr = address(kAudioHardwarePropertyProcessObjectList)
        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &addr, 0, nil, &dataSize
        )
        guard sizeStatus == noErr, dataSize > 0 else {
            if sizeStatus != noErr {
                Self.logger.debug("processObjectIDs size query failed: \(sizeStatus)")
            }
            return sizeStatus == noErr ? [] : nil
        }
        let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
        var ids = [AudioObjectID](repeating: 0, count: count)
        let readStatus = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &addr, 0, nil, &dataSize, &ids
        )
        guard readStatus == noErr else {
            Self.logger.debug("processObjectIDs read failed: \(readStatus)")
            return nil
        }
        return ids.filter { $0 != kAudioObjectUnknown }
    }

    @available(macOS 14.4, *)
    private static func bundleID(of objectID: AudioObjectID) -> String? {
        var addr = address(kAudioProcessPropertyBundleID)
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var value: Unmanaged<CFString>?
        let status = AudioObjectGetPropertyData(objectID, &addr, 0, nil, &size, &value)
        guard status == noErr else { return nil }
        // takeRetainedValue balances the "Get returns +1 retain" convention
        // that Apple's CoreAudio C API follows for CFString outputs.
        return value?.takeRetainedValue() as String?
    }

    @available(macOS 14.4, *)
    private static func isRunningInput(of objectID: AudioObjectID) -> Bool? {
        var addr = address(kAudioProcessPropertyIsRunningInput)
        var size = UInt32(MemoryLayout<UInt32>.size)
        var value: UInt32 = 0
        let status = AudioObjectGetPropertyData(objectID, &addr, 0, nil, &size, &value)
        guard status == noErr else { return nil }
        return value != 0
    }
}

// swiftlint:enable discouraged_optional_boolean
