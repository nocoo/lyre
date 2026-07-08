// scripts/probe/teams-window-probe.swift
//
// Phase 0 probe for docs/07-teams-meeting-detector.md (Rollout Phase 0 / C3).
//
// Dumps every ScreenCaptureKit-visible window that belongs to Microsoft Teams
// so we can:
//   - Verify that count(teamsWindows) >= 2 is a stable "in a meeting" signal.
//   - Collect real title samples for New Teams / Classic Teams across scenarios
//     (idle, chat popout, calendar popout, settings, in-meeting).
//   - Sanity check our excludedTitles whitelist.
//
// Usage:
//   swift scripts/probe/teams-window-probe.swift
//
// Requirements:
//   - macOS 15.0+ (SCShareableContent async API is available).
//   - Screen Recording permission granted to whichever binary runs this script
//     (e.g. Terminal.app / iTerm.app). Without the grant SCShareableContent
//     returns an empty list; the probe reports "empty" and exits 2.
//
// The probe writes:
//   - stdout: human-readable table + JSON payload (self-contained).
//
// Do NOT ship this file with the app. It stays under scripts/probe/ for later
// re-runs when Teams changes window titles.

import Foundation
import ScreenCaptureKit

// Match TeamsMeetingWatcher.teamsBundleIDs.
let teamsBundleIDs: Set<String> = [
    "com.microsoft.teams",
    "com.microsoft.teams2",
]

// Match TeamsMeetingWatcher.excludedTitles (lowercase compare).
let excludedTitles: Set<String> = [
    "microsoft teams",
    "settings",
    "设置",
    "preferences",
    "",
]

// Match TeamsMeetingWatcher.meetingTitleKeywords / meetingTitleSuffix.
let meetingTitleKeywords: [String] = ["meeting", "会议", "會議"]
let meetingTitleSuffix: String = " | microsoft teams"

struct WindowSnapshot: Codable {
    let bundleID: String
    let appName: String?
    let title: String?
    let windowID: UInt32
    let windowLayer: Int
    let isOnScreen: Bool
    let frame: [String: Double]
    let excludedByWhitelist: Bool
    let matchesMeetingKeyword: Bool
    let matchesMeetingSuffix: Bool
}

func classify(title: String?) -> (excluded: Bool, keyword: Bool, suffix: Bool) {
    let t = (title ?? "").lowercased()
    let excluded = excludedTitles.contains(t)
    let keyword = meetingTitleKeywords.contains(where: { t.contains($0) })
    let suffix = t.hasSuffix(meetingTitleSuffix)
    return (excluded, keyword, suffix)
}

func run() async {
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.current
    } catch {
        FileHandle.standardError.write(Data(
            "SCShareableContent failed: \(error.localizedDescription)\n"
                .utf8
        ))
        FileHandle.standardError.write(Data(
            "Hint: grant Screen Recording permission to your Terminal in System Settings > Privacy & Security > Screen Recording.\n"
                .utf8
        ))
        exit(2)
    }

    let teamsWindows = content.windows.filter { w in
        guard let bid = w.owningApplication?.bundleIdentifier else { return false }
        return teamsBundleIDs.contains(bid)
    }

    if teamsWindows.isEmpty {
        print("No Microsoft Teams windows visible to ScreenCaptureKit.")
        print("- Total windows enumerated: \(content.windows.count)")
        print("- If Teams IS running, either your Terminal lacks Screen Recording permission,")
        print("  or Teams currently has no on-screen windows (rare — check the tray).")
        exit(1)
    }

    let snapshots: [WindowSnapshot] = teamsWindows.map { w in
        let cls = classify(title: w.title)
        return WindowSnapshot(
            bundleID: w.owningApplication?.bundleIdentifier ?? "unknown",
            appName: w.owningApplication?.applicationName,
            title: w.title,
            windowID: w.windowID,
            windowLayer: w.windowLayer,
            isOnScreen: w.isOnScreen,
            frame: [
                "x": Double(w.frame.origin.x),
                "y": Double(w.frame.origin.y),
                "w": Double(w.frame.size.width),
                "h": Double(w.frame.size.height),
            ],
            excludedByWhitelist: cls.excluded,
            matchesMeetingKeyword: cls.keyword,
            matchesMeetingSuffix: cls.suffix
        )
    }

    // Human-readable table.
    // Swift `String` cannot be passed to C `%s`, so we pad with `padCell(_:_:)`
    // and join columns manually. Numeric fields use plain String(format:).
    func padCell(_ s: String, _ width: Int) -> String {
        if s.count >= width { return s }
        return s + String(repeating: " ", count: width - s.count)
    }
    func row(bundle: String, onscr: String, title: String, excl: String, kw: String, suf: String, frame: String, wid: String, layer: String) -> String {
        [
            padCell(bundle, 25),
            padCell(wid, 8),
            padCell(layer, 6),
            padCell(onscr, 6),
            padCell(title, 40),
            padCell(excl, 4),
            padCell(kw, 3),
            padCell(suf, 3),
            frame,
        ].joined(separator: " ")
    }

    print("=== Teams windows visible to SCShareableContent (\(snapshots.count)) ===")
    print(row(bundle: "bundle", onscr: "onscr", title: "title", excl: "excl", kw: "kw", suf: "suf", frame: "frame", wid: "winID", layer: "layer"))
    for s in snapshots {
        let title = s.title ?? "<nil>"
        let truncated = title.count > 40 ? String(title.prefix(37)) + "..." : title
        let frame = String(format: "%.0fx%.0f@(%.0f,%.0f)", s.frame["w"] ?? 0, s.frame["h"] ?? 0, s.frame["x"] ?? 0, s.frame["y"] ?? 0)
        print(row(
            bundle: s.bundleID,
            onscr: s.isOnScreen ? "yes" : "no",
            title: truncated,
            excl: s.excludedByWhitelist ? "yes" : "no",
            kw: s.matchesMeetingKeyword ? "yes" : "no",
            suf: s.matchesMeetingSuffix ? "yes" : "no",
            frame: frame,
            wid: String(s.windowID),
            layer: String(s.windowLayer)
        ))
    }

    // Judgement summary using the exact same rules as TeamsMeetingWatcher.judgeMeeting.
    let candidates = snapshots.filter { !$0.excludedByWhitelist }
    let countJudgement = candidates.count >= 2
    let keywordJudgement = candidates.contains { $0.matchesMeetingKeyword || $0.matchesMeetingSuffix }
    let active = countJudgement || keywordJudgement

    print("")
    print("=== judgeMeeting result ===")
    print("- non-excluded candidates: \(candidates.count) → count>=2 : \(countJudgement)")
    print("- any keyword/suffix hit  : \(keywordJudgement)")
    print("- final active            : \(active)")

    // JSON dump for the docs appendix.
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(snapshots),
       let json = String(data: data, encoding: .utf8) {
        print("")
        print("=== JSON payload ===")
        print(json)
    }
}

await run()
