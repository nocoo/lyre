# Teams Meeting Detector

> 检测 Microsoft Teams 会议的开始 / 结束，在合适的时机弹出模态对话框，
> 提示用户"是否开始录音 / 是否停止录音"。
> 目标：**极致轻量**（Teams 未运行时几乎零开销）、**只提示不动作**（录音的启停仍统一走
> `RecordingManager`）、**不引入新权限**（复用已有的 Screen Recording 授权）。

## Motivation

### Symptom & Product goal

用户使用 Lyre 录 Teams 会议时的两类事故：

1. 会议开始了，人还没反应过来点录音 → 前 5–10 分钟没录到。
2. 会议结束了，忘了停 → 磁盘 / OSS 上传 / ASR 都在录会后闲聊或屏幕背景音。

Product goal：在这两个时刻各弹一次**可秒关的**模态对话框，提示用户"开始录音 / 停止录音"，
仅此而已。**不主动开录、不主动停录**（防止误录、避免夺权），也**不做多平台**
（Zoom / Meet / Webex 明确不做，见 [Non-goals](#non-goals)）。

### Constraint — 极致轻量是核心目标之一

Lyre 是常驻菜单栏 App（`LSUIElement = true`），Teams meeting detector 会跟着常驻。
如果检测机制在 Teams 未运行时也持续消耗 CPU / IO，会把菜单栏 App 的静默功耗推上去，
违背菜单栏工具的基本礼仪。因此 **Teams 未运行时的检测路径必须无 IPC、无 syscall 密集轮询**，
只走 `NSWorkspace.runningApplications` 这种"读进程表"级别的操作。

### Constraint — 只做 Teams

用户明确决策：只做 Teams。Zoom / Meet / Webex 不做。原因：
- Teams 是用户主力会议工具，覆盖 > 90% 需求。
- 每加一个平台，窗口标题识别规则 + bundle ID 白名单都要新增维护成本。
- 多平台"通用会议检测"的开源实现（Recap / OpenOats）都不完美，
  Zoom / Meet 各自都有 corner case（Meet 是浏览器里的 tab，需要 URL 匹配 + 浏览器扩展）。

未来若明确需要 Zoom，再按本文档同样的模式扩一个 `ZoomMeetingWatcher`，
接入同一个 `MeetingPromptCoordinator` —— 结构就是为了扩展留口的。

## Detection Strategy

### Signal ranking（按权限成本 & 精度）

| 信号 | 权限 | 用途 |
|---|---|---|
| `NSWorkspace.runningApplications` + `didLaunch / didTerminate` 通知 | **无** | 判断 Teams 进程是否存活；控制轮询档位切换 |
| `SCShareableContent.current` 枚举窗口 | **已有的 Screen Recording**（录音就要） | Teams 会议窗口检测 —— **主判据** |
| `AXUIElement` / Accessibility API | ⚠️ 用户需在系统设置里手动授权 | **不使用**（`SCShareableContent` 已够用） |
| CoreAudio HAL `kAudioDevicePropertyDeviceIsRunningSomewhere` | 无 | **不使用**（不是 Teams 特有信号，Slack 通话、系统提示音都会触发） |
| EventKit calendar | 需要 Calendar 权限 | **不使用**（用户还没允许把日历给 Lyre） |

**结论**：`NSWorkspace`（控制轮询档位） + `SCShareableContent`（做 Teams 窗口识别）。
两者都不引入新权限。SCK 授权本来就是录音的前置条件，任何 Lyre 用户都已经点过同意。

### Teams bundle IDs

- `com.microsoft.teams` — Classic Teams（Electron，已停止新功能开发，企业里仍有部署）
- `com.microsoft.teams2` — New Teams（2023 年 10 月后默认；2024 中之后是唯一渠道，WebView2 架构）

**两个都必须匹配**。用 `Set<String>` 白名单，不用正则。

### Polling ladder（三档）

| 档位 | 触发条件 | 轮询周期 | 检测动作 |
|---|---|---|---|
| **cold** | Teams 进程不在 `runningApplications` 中 | **30 s** | 仅 `NSWorkspace.runningApplications` 扫一次，看是否出现 Teams |
| **warm** | Teams 运行，但当前判定"无会议" | **5 s** | 调 `SCShareableContent.current` → 匹配 Teams 窗口 → 判会议 |
| **hot** | 当前判定"会议中" | **5 s** | 同 warm；等 meeting 结束的信号 |

档位切换：

- `cold → warm`：`NSWorkspace.didLaunchApplication` 通知里，`bundleIdentifier ∈ TEAMS_BUNDLE_IDS`
  → 立即切档，无需等下一个 30s tick。
- `warm → cold`：`NSWorkspace.didTerminateApplication` 通知里，Teams 进程消失 → 立即切档。
  兜底：warm tick 时 `runningApplications` 里已无 Teams → 也切回 cold。
- `warm ↔ hot`：由会议判据（下节）驱动，需要经过**去抖**。

**极端场景兜底 —— "用户打开 Teams 立刻 join 会议"**：假设用户手动启动 Teams，
`didLaunch` 通知触发 `cold → warm` 切档。用户几秒内点了 Join Meeting，
warm 档 5s tick 检测到会议窗口 → 触发提示。**最坏延迟 ≈ 5s + SCK 查询耗时（几十 ms）**，
可以接受（用户决策明确：可以稍晚但不能不弹）。

**极端场景兜底 —— "先启动 Lyre，Teams 已经在开会"**：Lyre 启动时先跑一次 tick，
如果 Teams 已在 `runningApplications` 里，直接切到 warm 档并立即触发第一次 `SCShareableContent` 检测。

### Teams meeting window heuristic

`SCShareableContent.current.windows` 里，筛选出 `owningApplication?.bundleIdentifier ∈ TEAMS_BUNDLE_IDS`
的窗口子集 `teamsWindows`。判"会议中"的规则（**任一命中即算 active**，宁误弹一次也不漏）：

1. **数量判据**：`teamsWindows.count >= 2`。Teams 平常只开一个主窗口 `"Microsoft Teams"`；
   开会时会额外弹一个独立的会议窗口。这条覆盖绝大多数情况。
2. **标题关键词判据**：`teamsWindows` 中存在 `title` 包含以下任一子串
   （**大小写不敏感**，先 `lowercased()`）：
   - `"meeting"`（英）
   - `"会议"`（简体中文）
   - `"會議"`（繁体中文）
   - `" | microsoft teams"` 作为后缀（这是 New Teams 会议窗口标题的固定形态）
3. **排除项**：即使命中 (1) 或 (2)，若窗口 `title` 属于以下白名单，跳过：
   - `"Microsoft Teams"`（主窗口）
   - `"Settings"` / `"设置"` / `"Preferences"`
   - `""`（空标题的 offscreen 窗口，比如后台 renderer）

**为什么用数量判据而非精确标题匹配**：微软在 New Teams 每次迭代都会改会议窗口标题格式，
最近观察到有 `"Meeting in <subject> | Microsoft Teams"` / `"<subject> | Microsoft Teams"` /
`"<name>'s Meeting | Microsoft Teams"` 等变体，硬编码正则会持续失效。
"额外弹了个独立窗口"这个信号比标题格式稳定得多。

**已知假阳性**：Teams "Chat" 弹独立窗口、"Calendar" 弹日历弹窗时，`teamsWindows.count` 也可能 ≥ 2。
本设计选择**接受**这个假阳性 —— 用户看到 "是否开始录音" 弹窗，按 "Not now" 一秒关掉，
比漏检一场会议成本低得多。若后续用户反馈假阳性太多，再引入更严格的标题正则。

### Debounce / hysteresis

`SCShareableContent` 返回窗口列表有短暂抖动（Teams 会议开始的一瞬间窗口 map 未稳定，
或者 tick 恰好落在窗口 close 的中间）。**必须去抖**，否则会出现"弹了又收又弹"的骚扰。

规则：

- 内部维护一个 `pendingActive: Bool?`，代表"当前 tick 判定"。
- 只有 **连续 2 个 tick** 判定一致（都 active 或都 inactive），才把 `meetingActive` 切换到该值。
- **首次 tick 的判定要立即生效**：Lyre 冷启动时 `meetingActive = nil`，第一次拿到判定后
  直接置为 true/false，不等第二个 tick。（防止 Lyre 启动瞬间正好在会中 → 需要 10s 才弹）
- 首次生效**不弹提示**（只是刷新初始状态），后续所有变化才弹。

时间开销：稳态下每 5s 一次 `SCShareableContent`，切换事件平均延迟 5–10s。

### Per-meeting suppression

一场会议内**最多弹一次**每种提示：

- 一次 `false→true` 切换 → 弹一次"开始录音"提示，无论用户按什么，本次会议不再弹（防连续骚扰）。
- 一次 `true→false` 切换 → 弹一次"停止录音"提示，同样只弹一次。
- 下一场会议（重新经历 `false→true`）→ 抑制标记复位，重新有资格弹。

抑制状态在 `MeetingPromptCoordinator` 内部维护，不持久化 —— Lyre 重启即清空。

### Prompt gating（交叉判定 recorder.state）

不是每次 meeting 状态跨越都要弹：

| meeting 变化 | `recorder.state` | 是否弹 | 弹什么 |
|---|---|---|---|
| `false → true`（开始） | `.idle` | ✅ | "Teams 会议已开始，是否开始录音？" [Start recording] [Not now] |
| `false → true`（开始） | `.recording` | ❌ | 用户已经在录，不打扰 |
| `true → false`（结束） | `.recording` | ✅ | "Teams 会议已结束，是否停止录音？" [Stop recording] [Keep recording] |
| `true → false`（结束） | `.idle` | ❌ | 用户根本没录，不打扰 |

## Module Layout

**Scope**：只新增 `apps/macos/Lyre/Meeting/` 目录，不修改 `Audio/` 下任何文件。
`LyreApp.swift` 加 3–5 行接线（构造 watcher + coordinator，绑定到 `recorder`）。

```
apps/macos/Lyre/
├── Meeting/                                  # 新增
│   ├── TeamsMeetingWatcher.swift             # 检测器：轮询 + NSWorkspace 观察 + 发布 meetingActive
│   ├── MeetingPromptCoordinator.swift        # 交叉判 recorder.state → 弹 NSAlert → 触发录音
│   └── MeetingDetectionSettings.swift        # UserDefaults-backed 用户开关
├── Views/Settings/
│   └── GeneralSettingsView.swift             # 已存在则追加开关，不存在则本次一并新建
└── LyreApp.swift                             # +3–5 行接线
```

对应测试：

```
apps/macos/LyreTests/
├── TeamsMeetingWatcherTests.swift            # 窗口识别规则 / 去抖 / 档位切换
└── MeetingPromptCoordinatorTests.swift       # 抑制 / 交叉判定 / NSAlert 触发
```

### TeamsMeetingWatcher

职责：三档轮询、`NSWorkspace` 观察、窗口识别、去抖、发布 `meetingActive: Bool`。
**不与 `RecordingManager` 直接耦合** —— coordinator 才是耦合层。

```swift
import Foundation
import AppKit
import ScreenCaptureKit
import Observation
import os

@Observable
@MainActor
final class TeamsMeetingWatcher {
    /// 唯一对外状态。coordinator / UI 订阅这个即可。
    /// nil = 尚未完成第一次检测（Lyre 刚启动）
    private(set) var meetingActive: Bool? = nil

    /// 当前档位（诊断用，UI 一般不订阅）
    private(set) var tier: Tier = .cold

    enum Tier { case cold, warm, hot }

    // MARK: - Constants
    static let teamsBundleIDs: Set<String> = [
        "com.microsoft.teams",       // Classic
        "com.microsoft.teams2",      // New Teams
    ]
    /// 会议关键词（小写；title.lowercased() 后 contains 匹配）
    static let meetingTitleKeywords: [String] = [
        "meeting", "会议", "會議",
    ]
    /// 会议窗口标题后缀（New Teams 稳定格式）
    static let meetingTitleSuffix: String = " | microsoft teams"
    /// 明确排除的窗口标题（小写）
    static let excludedTitles: Set<String> = [
        "microsoft teams", "settings", "设置", "preferences", "",
    ]

    private let coldInterval: TimeInterval = 30
    private let warmInterval: TimeInterval = 5

    // MARK: - Internals
    private var tickTimer: Timer?
    private var launchObserver: NSObjectProtocol?
    private var terminateObserver: NSObjectProtocol?

    /// 去抖：连续 2 个 tick 一致才切换 meetingActive
    private var pendingActive: Bool?

    // MARK: - Lifecycle
    func start() {
        installWorkspaceObservers()
        // 首次 tick 立即跑一次（用户可能启动 Lyre 时 Teams 已经在开会）
        recomputeTier(runTickImmediately: true)
    }

    func stop() {
        tickTimer?.invalidate(); tickTimer = nil
        if let o = launchObserver { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        if let o = terminateObserver { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        launchObserver = nil; terminateObserver = nil
    }

    // MARK: - NSWorkspace observers (免费的即时档位切换)
    private func installWorkspaceObservers() {
        let nc = NSWorkspace.shared.notificationCenter
        launchObserver = nc.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification,
            object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bid = app.bundleIdentifier,
                  Self.teamsBundleIDs.contains(bid) else { return }
            Task { @MainActor in self?.recomputeTier(runTickImmediately: true) }
        }
        terminateObserver = nc.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bid = app.bundleIdentifier,
                  Self.teamsBundleIDs.contains(bid) else { return }
            Task { @MainActor in self?.recomputeTier(runTickImmediately: false) }
        }
    }

    // MARK: - Tier control
    /// 决定档位（依据 Teams 进程是否存活 + 当前 meetingActive）+ 重排 timer
    /// 可选立即再跑一次 tick（`didLaunch` 场景需要即时反应）
    private func recomputeTier(runTickImmediately: Bool) {
        let teamsAlive = isTeamsRunning()
        let newTier: Tier
        if !teamsAlive {
            newTier = .cold
            // Teams 关了也把 meetingActive 强制归 false（不走去抖，直接落）
            if meetingActive == true { fireStateChange(to: false) }
            meetingActive = false
            pendingActive = false
        } else {
            newTier = (meetingActive == true) ? .hot : .warm
        }
        tier = newTier
        rescheduleTimer()
        if runTickImmediately { tick() }
    }

    private func rescheduleTimer() {
        tickTimer?.invalidate()
        let interval = (tier == .cold) ? coldInterval : warmInterval
        tickTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func isTeamsRunning() -> Bool {
        NSWorkspace.shared.runningApplications.contains {
            guard let bid = $0.bundleIdentifier else { return false }
            return Self.teamsBundleIDs.contains(bid)
        }
    }

    // MARK: - Tick
    private func tick() {
        switch tier {
        case .cold:
            // cold tick 只查进程表 —— 极致轻量
            if isTeamsRunning() { recomputeTier(runTickImmediately: true) }
        case .warm, .hot:
            Task { await checkTeamsWindows() }
        }
    }

    private func checkTeamsWindows() async {
        do {
            let content = try await SCShareableContent.current
            let teamsWindows = content.windows.filter { win in
                guard let bid = win.owningApplication?.bundleIdentifier else { return false }
                return Self.teamsBundleIDs.contains(bid)
            }
            let active = judgeMeeting(from: teamsWindows)
            applyDebounced(active: active)
        } catch {
            // 权限被撤销、SCK 挂了等 —— 保守当作 inactive
            Self.logger.warning("SCShareableContent failed: \(error.localizedDescription)")
            applyDebounced(active: false)
        }
    }

    private func judgeMeeting(from windows: [SCWindow]) -> Bool {
        // 排除白名单标题后计数
        let candidates = windows.filter { win in
            let t = (win.title ?? "").lowercased()
            return !Self.excludedTitles.contains(t)
        }
        if candidates.count >= 2 { return true }
        for win in candidates {
            let t = (win.title ?? "").lowercased()
            if t.hasSuffix(Self.meetingTitleSuffix) { return true }
            for kw in Self.meetingTitleKeywords where t.contains(kw) { return true }
        }
        return false
    }

    // MARK: - Debounce
    private func applyDebounced(active: Bool) {
        // 首次 tick：直接落，不弹提示（fireStateChange 由 pendingActive 首次 nil→值 时抑制）
        if meetingActive == nil {
            meetingActive = active
            pendingActive = active
            // tier 可能需要升 hot（如果直接落成 true）
            if active { recomputeTier(runTickImmediately: false) }
            return
        }
        if pendingActive == active && meetingActive != active {
            // 连续 2 个 tick 一致 → 切换
            let previous = meetingActive!
            meetingActive = active
            fireStateChange(to: active)
            // 会议开始 → 升 hot；会议结束 → 降 warm
            recomputeTier(runTickImmediately: false)
            _ = previous
        }
        pendingActive = active
    }

    private func fireStateChange(to active: Bool) {
        // 只是 hook 点。真正的 UI 触发由 coordinator 订阅 meetingActive 完成。
        Self.logger.info("meetingActive changed to \(active)")
    }

    private static let logger = Logger(subsystem: "ai.hexly.lyre", category: "TeamsMeetingWatcher")
}
```

**关键并发/隔离约束**：
- 整个类 `@MainActor` 隔离 —— `SCShareableContent` 和 `NSWorkspace` 都是 main-actor-friendly，
  避开 Swift 6 strict concurrency 的 Sendable 报错。
- `NSWorkspace` observer 的 closure 在 main queue 上，用 `Task { @MainActor in ... }` 桥回主 actor。
- `Timer.scheduledTimer` 的 closure 在 main run loop 上，同样桥回。

### MeetingPromptCoordinator

职责：订阅 `watcher.meetingActive` 变化 + 读 `recorder.state` → 决定是否弹 NSAlert → 触发 `recorder.startRecording()` / `stopRecording()`。

```swift
import Foundation
import AppKit
import Observation
import os

@Observable
@MainActor
final class MeetingPromptCoordinator {
    private let watcher: TeamsMeetingWatcher
    private let recorder: RecordingManager
    private let settings: MeetingDetectionSettings

    /// 每场会议的抑制标记（本地会话内有效，不持久化）
    private var startPromptShownForCurrentMeeting = false
    private var stopPromptShownForCurrentMeeting  = false

    /// 上一次观察到的 meetingActive（用来判"跨越"）
    private var lastObservedActive: Bool? = nil

    /// Observation tracking token
    private var observationTask: Task<Void, Never>?

    init(watcher: TeamsMeetingWatcher, recorder: RecordingManager, settings: MeetingDetectionSettings) {
        self.watcher = watcher
        self.recorder = recorder
        self.settings = settings
    }

    func start() {
        // 使用 Observation withObservationTracking 循环订阅 watcher.meetingActive
        observationTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                await self?.observeOnce()
            }
        }
    }

    func stop() {
        observationTask?.cancel(); observationTask = nil
    }

    @MainActor
    private func observeOnce() async {
        // 拿一个 continuation，等 watcher.meetingActive 变化
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            withObservationTracking {
                _ = watcher.meetingActive
            } onChange: {
                Task { @MainActor in cont.resume() }
            }
        }
        handleChange()
    }

    private func handleChange() {
        guard settings.isEnabled else {
            // 用户关掉了功能：更新 lastObservedActive 但不弹
            lastObservedActive = watcher.meetingActive
            return
        }
        let now = watcher.meetingActive
        defer { lastObservedActive = now }
        guard let previous = lastObservedActive, let current = now else { return }
        if previous == current { return }

        if !previous && current {
            // false → true：会议开始
            startPromptShownForCurrentMeeting = false  // reset from any previous meeting cycle
            stopPromptShownForCurrentMeeting  = false
            if recorder.state == .idle && !startPromptShownForCurrentMeeting {
                startPromptShownForCurrentMeeting = true
                promptStart()
            }
        } else if previous && !current {
            // true → false：会议结束
            if recorder.state == .recording && !stopPromptShownForCurrentMeeting {
                stopPromptShownForCurrentMeeting = true
                promptStop()
            }
        }
    }

    // MARK: - Prompt UI
    private func promptStart() {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = String(localized: "Teams meeting detected")
        alert.informativeText = String(localized: "Start recording this meeting?")
        alert.addButton(withTitle: String(localized: "Start Recording"))  // return .alertFirstButtonReturn
        alert.addButton(withTitle: String(localized: "Not now"))          // .alertSecondButtonReturn
        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            Task { await triggerStart() }
        }
    }

    private func promptStop() {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = String(localized: "Teams meeting ended")
        alert.informativeText = String(localized: "Stop recording?")
        alert.addButton(withTitle: String(localized: "Stop Recording"))
        alert.addButton(withTitle: String(localized: "Keep Recording"))
        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            Task { await triggerStop() }
        }
    }

    private func triggerStart() async {
        do { try await recorder.startRecording() }
        catch { Self.logger.error("start via prompt failed: \(error.localizedDescription)") }
    }

    private func triggerStop() async {
        do { _ = try await recorder.stopRecording() }
        catch { Self.logger.error("stop via prompt failed: \(error.localizedDescription)") }
    }

    private static let logger = Logger(subsystem: "ai.hexly.lyre", category: "MeetingPromptCoordinator")
}
```

**关键点**：
- 录音的启停**统一走 `RecordingManager` 现有的 `startRecording()` / `stopRecording()`**。
  Coordinator 只是"触发者"，不复制录音逻辑（用户约束 #4）。
- `NSAlert.runModal()` 会阻塞当前 run loop —— 菜单栏 App 里这是正常做法（参见 `TrayMenu.showErrorAlert`）。
  用户按任一按钮或 Cmd-W / Esc 都会立即返回，秒关（用户约束 #1）。
- `NSApp.activate(ignoringOtherApps: true)` 前置一次，保证 Teams 全屏时 Lyre 的 alert 能抢焦点。

### MeetingDetectionSettings

```swift
import Foundation
import Observation

@Observable
final class MeetingDetectionSettings {
    private let defaultsKey = "meeting.detection.enabled"

    var isEnabled: Bool {
        didSet { UserDefaults.standard.set(isEnabled, forKey: defaultsKey) }
    }

    init() {
        // 首次装机默认开启（用户核心目标就是这个）
        if UserDefaults.standard.object(forKey: defaultsKey) == nil {
            UserDefaults.standard.set(true, forKey: defaultsKey)
        }
        self.isEnabled = UserDefaults.standard.bool(forKey: defaultsKey)
    }
}
```

Settings 面板加一行开关："Detect Teams meetings and prompt to record"，绑定 `isEnabled`。

### LyreApp 接线

```swift
// LyreApp.swift init()
init() {
    let cfg = AppConfig()
    let mgr = RecordingManager()
    mgr.outputDirectory = cfg.outputDirectory
    let mtgSettings = MeetingDetectionSettings()
    let watcher = TeamsMeetingWatcher()
    let coord   = MeetingPromptCoordinator(watcher: watcher, recorder: mgr, settings: mtgSettings)
    watcher.start()
    coord.start()
    _config = State(initialValue: cfg)
    _recorder = State(initialValue: mgr)
    _recordingsStore = State(initialValue: RecordingsStore(directory: cfg.outputDirectory))
    _meetingSettings = State(initialValue: mtgSettings)
    _meetingWatcher = State(initialValue: watcher)
    _meetingCoordinator = State(initialValue: coord)
}
```

## Design Principles

1. **Teams-only, single detector**：一个 `TeamsMeetingWatcher`，不做通用 `MeetingObserver` 抽象。
   YAGNI —— 后续加 Zoom 时再抽（可能只需要抽 `MeetingSignal` protocol，不需要重构现有代码）。
2. **No new permissions**：不用 Accessibility、不用 Calendar、不用 CoreAudio process listener。
   只用 SCK（已有）+ NSWorkspace（免费）。
3. **Cold path 零 IPC**：Teams 未运行时 30s tick 只读 `runningApplications`，
   无 SCK 查询、无窗口枚举。Lyre 常驻状态下 90% 时间处于 cold 档，功耗 ≈ 0。
4. **Prompt only, never act**：只弹对话框，不主动动录音。录音的启停统一由 `RecordingManager` 承担
   （用户约束 #4）。Coordinator 是"UI 层触发者"而非"录音层控制者"。
5. **Debounce > accuracy**：宁可延迟 5–10s 发提示，也不弹后立刻收回。用户看到一次假阳性弹窗
   （按 Not now 就消失）比看到"弹了收弹了收"的骚扰更能容忍。
6. **Per-meeting suppression**：一场会议内每种提示最多一次。用户按 Not now 后不再骚扰。
7. **No persistence of transient state**：只持久化 `isEnabled` 开关。会议 active 状态、抑制标记
   都在内存里，重启即清空 —— 简单、正确。

## Testing Strategy

### Unit tests

| 测试 | 操作 |
|---|---|
| `TeamsMeetingWatcherTests` — `judgeMeeting` 数量判据 | 构造 2 个 `SCWindow` 桩（bundleID 都是 `com.microsoft.teams2`，title 分别是 `"Microsoft Teams"` / `"Meeting in Sprint | Microsoft Teams"`）→ 断言 `judgeMeeting(from:) == true`。**技术点**：`SCWindow` 无法直接构造；改测 `judgeMeeting` 的等价纯函数版本 `Self.judge(candidates:)` 接受 `[(bundleID: String, title: String?)]`，把类方法暴露成 internal 便于单测。 |
| `TeamsMeetingWatcherTests` — 标题关键词判据 | 单一 Teams 窗口，title 分别为 `"会议：产品评审"` / `"讨论 | Microsoft Teams"` / `"Random Chat"` → 前两个 active、第三个 inactive。 |
| `TeamsMeetingWatcherTests` — 排除白名单 | 2 个 Teams 窗口，title 都是 `"Microsoft Teams"` / `"Settings"` → 排除后 candidates=0 → inactive（不因数量 >=2 误判）。 |
| `TeamsMeetingWatcherTests` — 去抖 | Mock 一个 tick 序列 `[true, false, true, true, true]` → 断言 `meetingActive` 序列 `[nil→true(首次), (第2次false 不切), (第3次true 不切因为前一次是false), (第4次true → pending==active==true → 已经是true 不动), (第5次true → 同)]`。仔细设计边界。 |
| `TeamsMeetingWatcherTests` — 首次生效不弹提示 | 首次 tick `true` → `meetingActive` 直接为 true，`fireStateChange` **不**被调用（区分"初始状态"和"变化事件"）。 |
| `MeetingPromptCoordinatorTests` — start prompt gating | 构造 `RecordingManager` mock 状态 `.idle`，触发 `meetingActive: false → true` → 断言 promptStart 被调用（用 test double 替换 `NSAlert.runModal()` —— 抽 `AlertPresenter` protocol 注入）。 |
| `MeetingPromptCoordinatorTests` — 录音中不弹 start | mock recorder 状态 `.recording`，触发 `false → true` → 不调用 promptStart。 |
| `MeetingPromptCoordinatorTests` — idle 状态不弹 stop | mock recorder 状态 `.idle`，触发 `true → false` → 不调用 promptStop。 |
| `MeetingPromptCoordinatorTests` — 一场会议只弹一次 start | mock recorder `.idle`；触发 `false → true` → 弹一次；`.idle` 保持；再次触发 `false → true`（**中间没经过 true → false**，理论上 debouncer 不会连发，但确认代码防御性）→ 不再弹。 |
| `MeetingPromptCoordinatorTests` — 用户关掉开关 | `settings.isEnabled = false`，触发 `false → true` → 不弹，但 `lastObservedActive` 仍被更新（防止重新开启后误弹旧变化）。 |

**注入策略**：
- `TeamsMeetingWatcher` 内部把"检测 Teams 是否运行"和"查询窗口列表"抽成 protocol，
  测试时注入 fake 实现，避免测试依赖真的 Teams App。
- `MeetingPromptCoordinator` 里 `NSAlert.runModal()` 抽成 `AlertPresenting` protocol，
  测试用 double 记录调用次数和参数，不弹真 alert。

### Manual acceptance（release 前必跑，同 06 的 6DQ 风格）

1. **DQ-1 Teams 不运行时的功耗**：Lyre 启动，Teams 完全关闭。用 Activity Monitor 观察 Lyre 进程
   30 分钟 —— CPU 占用应 < 0.1%。（cold 档 30s tick 只读 running apps）
2. **DQ-2 打开 Teams 立即 join 会议**：从关闭状态启动 Teams → 立刻点日历里的 Join → 观察 Lyre
   是否在 15 秒内弹出 "Start recording" 提示。（`didLaunch` 触发 warm 档 → 首次 warm tick 立即触发）
3. **DQ-3 会议中启动 Lyre**：Teams 会议已经在进行中 → 启动 Lyre → 观察 5–10 秒内是否弹提示。
   （首次 tick 直接落 meetingActive=true 不弹，但 handleChange 里 `lastObservedActive=nil` → 有一段边界要仔细看：coordinator 的 `handleChange` guard 条件 `guard let previous = ..., let current = ...` 会跳过第一次。这是**故意的** —— Lyre 启动时用户可能正在开会但不希望被打扰，除非会议**变化**）。
   → **决策**：DQ-3 场景**不弹提示**。用户约束是"会议开始时提示"，不是"启动 Lyre 时提示"，两者语义不同。若用户希望"启动时也提示当前会议中"，作为后续 issue。
4. **DQ-4 假阳性**：Teams 打开 Chat 独立窗口（有的 org 允许 chat 弹出为独立窗口） → 观察是否误弹。
   如果误弹率高于每天 1 次，考虑收紧判据。
5. **DQ-5 会议结束提示**：录音中，主持人 End Meeting → 观察 5–15 秒内是否弹 "Stop recording"。
6. **DQ-6 关掉开关**：Settings 里关掉开关 → 开会不弹。重新开启 → 下一场会议开始时正常弹。

## Compatibility & Migration

- **macOS minimum**：15.0（跟随现有约束，`SCShareableContent` / `NSWorkspace` 都无所谓）。
- **权限**：不新增。SCK 授权是录音的前置条件，本 feature 复用。
- **老用户**：默认开启（`MeetingDetectionSettings.isEnabled` 初值 true）。首次弹窗即为功能提示，
  不需要 onboarding 步骤。
- **Teams 未安装的用户**：cold 档持续，无提示，无影响。
- **测试环境**：Xcodebuild test 里 `NSWorkspace` / SCK 都能跑，注入 fake 后无外部依赖。

## Risk & Fallback

| 风险 | 触发条件 | 降级 |
|---|---|---|
| 窗口标题格式再次变化 | Microsoft 改 New Teams 会议窗口标题 → 关键词判据失效 | 数量判据仍生效（`teamsWindows.count >= 2`）—— 双判据的作用。仅当数量也不满足时才会漏检。 |
| SCK 权限被撤销 | 用户在系统设置里撤销 Screen Recording | `SCShareableContent.current` 抛错 → watcher 保守当 inactive → 用户不会收到误报。录音本身也无法启动，用户会察觉到。 |
| Cmd-Tab 切窗时 alert 被埋 | Teams 全屏 + 用户在别的 Space | `NSApp.activate(ignoringOtherApps: true)` 前置调用 —— 会跳到 Lyre 所在的 Space。如果仍被埋，用户下一次切回 Lyre 会看到 alert 挂着（`runModal()` 会一直等）。 |
| 假阳性太多 | DQ-4 中标题白名单不够广 | 逐步扩 `excludedTitles` 白名单。极端情况下改用"必须命中标题关键词"的严格判据（放弃数量判据）。 |
| Teams 崩溃 → 进程还在但无窗口 | 极少见 | warm tick 检测不到会议窗口 → 平滑降为 inactive → 如果正在录音会误弹 "Stop recording"。用户按 Keep recording 即可。 |

## Non-goals

- **不做 Zoom / Meet / Webex** —— 用户明确决策，只做 Teams。
- **不做日历集成** —— 不申请 Calendar 权限。
- **不主动开录 / 停录** —— 只弹提示。所有真正的录音动作走 `RecordingManager`。
- **不做转录 / 摘要触发** —— 会议检测不联动 AI summary、上传等下游流程，那些是录音结束后
  已有流水线的事。
- **不持久化会议历史** —— Watcher 不记录"过去发生过哪些会议"，只关心 now。
- **不做通用 `MeetingObserver` 抽象** —— 目前只有一个 detector，不引入不必要的多态。
- **不用 UserNotifications 横幅通知** —— 用户明确要模态对话框（可打断、可秒关）。
  UserNotifications 需要新权限，且用户可能配 DND 静音。

## Rollout

按以下顺序执行，前一步是后一步的前置门禁：

**Phase 0 — 探针 & 验证（半天）**

1. 写一个临时 CLI Swift 脚本，跑 `SCShareableContent.current`，在你本机开 Teams + 打开 / 结束几次
   真实会议，dump `teamsWindows` 的 `(title, frame, isOnScreen)`。
   目的：**校准数量判据 + 标题关键词是否真的命中当前 Teams 版本**。若发现新窗口标题格式，
   补进 `meetingTitleKeywords`。
2. 观察 Teams 打开 Chat / Settings / Calendar 弹出窗口时 `teamsWindows` 的形态，
   评估假阳性风险，必要时扩 `excludedTitles`。
3. 结论写进 PR 描述。

**Phase 1 — 代码（1 天）**

4. 新建 `Meeting/` 目录 + 3 个源文件（`TeamsMeetingWatcher` / `MeetingPromptCoordinator` /
   `MeetingDetectionSettings`）。
5. Settings 面板加开关。
6. `LyreApp.swift` 接线。
7. `xcodegen generate` + `xcodebuild build` + `swiftlint --strict Lyre/` 全绿。

**Phase 2 — 测试（半天）**

8. 写 `TeamsMeetingWatcherTests` + `MeetingPromptCoordinatorTests`（10 条用例，见 Testing Strategy）。
9. `xcodebuild test` 全绿。

**Phase 3 — 手工验收（1 小时）**

10. 跑 DQ-1 到 DQ-6。全部通过 → 合并。
11. 更新 `CLAUDE.md` 的 Retrospective（若在 Phase 0/2/3 学到 macOS API 的坑）。

**Phase 4（条件触发）**

12. 若 DQ-4 假阳性率高 → 收紧判据（去掉数量判据、依赖严格标题关键词），发一版补丁。
13. 若用户反馈 "希望启动 Lyre 时也提示当前会议中" → 单独开 issue 讨论 DQ-3 决策变更。

## References

- Apple — [`SCShareableContent`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent)
- Apple — [`NSWorkspace.runningApplications`](https://developer.apple.com/documentation/appkit/nsworkspace/1534059-runningapplications)
- Apple — [`NSAlert`](https://developer.apple.com/documentation/appkit/nsalert)
- Apple — [Observation framework](https://developer.apple.com/documentation/observation)
- [yazinsai/OpenOats — `MeetingDetector.swift`](https://github.com/yazinsai/OpenOats) — 参考的多平台会议检测实现（本项目仅取其"进程 + SCK 窗口"双判据思路，不采纳其 CoreAudio mic listener 路径）
- [RecapAI/Recap — `AudioProcess.swift`](https://github.com/RecapAI/Recap) — 参考 bundle ID 白名单模式
- Granola [Permissions FAQ](https://docs.granola.ai/help-center/getting-started/setting-up-granola-for-the-first-time) — 佐证"不需要 Accessibility 也能做会议感知"的产品先例
