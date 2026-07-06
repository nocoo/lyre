# Teams Meeting Detector

> 检测 Microsoft Teams 会议的开始 / 结束，在合适的时机弹出模态对话框，
> 提示用户"是否开始录音 / 是否停止录音"。
>
> **产品指标（哥定）**：
> 1. 极致轻量、稳定，性能消耗小
> 2. 提示直接了当，但用户可以极易关掉，且不影响其他任何事情
>
> **架构约束**：**只提示不动作**（录音的启停统一走 `RecordingActionController` 层，
> tray 与 detector 走同一入口），**不引入新权限**（复用已有的 Screen Recording 授权，
> 未授权时静默 inactive）。

## Status

- 阶段：设计（v1，已合并 Reviewer 首轮意见 + 我的 A-D 补充点 + Q1/Q2 定案）
- 作者：MBP-SDE-A
- 审查：MBP-Reviewer-A
- 决策人：@zheng-li

## Motivation

### Symptom & Product goal

用户使用 Lyre 录 Teams 会议时的两类事故：

1. 会议开始了，人还没反应过来点录音 → 前 5–10 分钟没录到。
2. 会议结束了，忘了停 → 磁盘 / OSS 上传 / ASR 都在录会后闲聊或屏幕背景音。

Product goal：在这两个时刻各弹一次**可秒关的**模态对话框，提示用户"开始录音 / 停止录音"，
仅此而已。**不主动开录、不主动停录**（防止误录、避免夺权），也**不做多平台**
（Zoom / Meet / Webex 明确不做，见 [Non-goals](#non-goals)）。

### Constraint — 极致轻量是核心目标之一

Lyre 是常驻菜单栏 App（`LSUIElement = true`，见 `apps/macos/Lyre/Info.plist`），Teams meeting
detector 会跟着常驻。如果检测机制在 Teams 未运行时也持续消耗 CPU / IO，会把菜单栏 App 的
静默功耗推上去，违背菜单栏工具的基本礼仪。因此 **Teams 未运行时的检测路径必须无 IPC、
无 syscall 密集轮询**，只走 `NSWorkspace.runningApplications` 这种"读进程表"级别的操作。

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

### Screen Recording 授权状态处理（v1 明确，来自 Reviewer 反馈 #4）

Lyre 的 `PermissionManager` 已经维护 SCK 授权判定。detector 在启动/每次 warm tick 前
读取该判定：

- **未授权**：watcher 保持 warm/cold 档位不变，**跳过** `SCShareableContent.current` 调用，
  静默判 inactive，**不重复打日志**（每次会话最多一条 info），**不触发系统引导 alert**，
  **不弹会议提示**。Screen Recording 的引导流程仍走现有 `PermissionGuideView`，
  由录音动作触发，不因 detector 而额外拉起。
- **首次授权变化**（撤销 → 授予或授予 → 撤销）：watcher 观察 `PermissionManager` 的
  `screenCaptureGranted` 变化，state 变化后下一次 tick 自然重新走判定。
- **调用抛错**（授权被撤销但状态还没同步、SCK 挂了）：一次性 `warning` 日志 +
  保守判 inactive；不主动弹 alert 打扰用户。

### Teams bundle IDs

- `com.microsoft.teams` — Classic Teams（Electron，已停止新功能开发，企业里仍有部署）
- `com.microsoft.teams2` — New Teams（2023 年 10 月后默认；2024 中之后是唯一渠道，WebView2 架构）

**两个都必须匹配**。用 `Set<String>` 白名单，不用正则。

### Polling ladder（三档）

| 档位 | 触发条件 | 轮询周期 | 检测动作 |
|---|---|---|---|
| **cold** | Teams 进程不在 `runningApplications` 中 | **30 s** | 仅 `NSWorkspace.runningApplications` 扫一次 |
| **warm** | Teams 运行，但当前判定"无会议" | **5 s** | `SCShareableContent.current` → 匹配 Teams 窗口 → 判会议 |
| **hot** | 当前判定"会议中" | **5 s** | 同 warm；等 meeting 结束的信号 |

档位切换：

- `cold → warm`：`NSWorkspace.didLaunchApplication` 通知里，`bundleIdentifier ∈ TEAMS_BUNDLE_IDS`
  → 立即切档，无需等下一个 30s tick。
- `warm → cold`：`NSWorkspace.didTerminateApplication` 通知里，Teams 进程消失 → 立即切档。
  兜底：warm tick 时 `runningApplications` 里已无 Teams → 也切回 cold。
- `warm ↔ hot`：由会议判据（下节）驱动，需要经过**去抖**。

**极端场景兜底 —— 用户手动启动 Teams 并立即入会**：`didLaunch` 触发 `cold → warm`，
warm 档 5s tick 内检测到会议窗口 → 触发提示。**最坏延迟 ≈ 5s + SCK 查询耗时**，
可接受（用户决策：可以稍晚但不能不弹）。

**极端场景兜底 —— 先启动 Lyre，Teams 已经在开会**：见下面 **[启动时会议中的语义](#启动时会议中的语义v1-澄清来自-reviewer-反馈-5)**。

### Teams meeting window heuristic

`SCShareableContent.current.windows` 里，筛选出 `owningApplication?.bundleIdentifier ∈ TEAMS_BUNDLE_IDS`
的窗口子集 `teamsWindows`。判"会议中"的规则（**任一命中即算 active**，宁误弹一次也不漏）：

1. **数量判据**：`teamsWindows.count >= 2`（排除白名单标题后）。Teams 平常只开一个主窗口
   `"Microsoft Teams"`；开会时会额外弹一个独立的会议窗口。这条覆盖绝大多数情况。
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

**已知假阳性**：Teams "Chat" 弹独立窗口、"Calendar" 弹日历弹窗时，`teamsWindows.count` 也可能 ≥ 2。
本设计选择**接受**这个假阳性 —— 用户看到 "是否开始录音" 弹窗，按 "Not now" 一秒关掉，
比漏检一场会议成本低得多。Phase 0 探针会实际测量假阳性率，若超阈值再收紧判据（见 [Rollout](#rollout)）。

### Debounce / hysteresis

`SCShareableContent` 返回窗口列表有短暂抖动（会议开始的一瞬间窗口 map 未稳定，
或者 tick 恰好落在窗口 close 的中间）。**必须去抖**，否则会出现"弹了又收又弹"的骚扰。

规则（watcher 内部）：

- 维护 `lastRawJudgement: Bool?`，代表"上一 tick 的原始判定"。
- 维护 `confirmedActive: Bool?`，代表"已确认的会议状态"。
- **只有连续 2 个 tick 的 raw 判定一致，才把 `confirmedActive` 切换到该值**。切换成功后，
  向 `AsyncStream` yield 一次事件。

### 启动时会议中的语义（v1 澄清，来自 Reviewer 反馈 #5）

**统一规则**：
1. Watcher 启动时，先跑一次 baseline tick（异步，不阻塞 start）。
2. 无论 baseline 结果是 true 还是 false，都只**设置内部状态**，**不 yield 到 stream**。
3. 之后所有从 baseline 出发的**变化**（经过去抖确认后），才 yield 到 stream。
4. Coordinator 只消费 stream，因此启动时会议中的场景不会弹 start prompt。

这条规则同时解决了：
- 冷启动时正好在会议中不误弹（用户会去手动开 tray 里的 Start Recording）。
- 冷启动时没有会议，之后开会仍能正常弹。

如果未来产品决策改为"启动时也提示当前会议中"，只需 watcher 增加一个"启动后 30s 内 first
change from baseline that is active"的特殊 event，coordinator 增加一条 gating 即可，
不动去抖流程。

### Per-meeting suppression

一场会议内**最多弹一次**每种提示：

- 一次 `false→true` 切换 → 弹一次"开始录音"提示，无论用户按什么，本次会议不再弹（防连续骚扰）。
- 一次 `true→false` 切换 → 弹一次"停止录音"提示，同样只弹一次。
- 下一场会议（重新经历 `false→true`）→ 抑制标记复位，重新有资格弹。

抑制状态在 `MeetingPromptCoordinator` 内部维护，不持久化 —— Lyre 重启即清空。

### Single-alert 在场规则（v1 新增，来自 Reviewer 反馈 #6）

`NSAlert.runModal()` 阻塞 main run loop —— 若 alert 打开期间又有新 event 到达，
必须**丢弃**而非排队，否则用户会看到"关一个还有一个"的骚扰。

规则：

- Coordinator 维护 `isPromptPresented: Bool`。
- 收到 event 时，先检查 `isPromptPresented` 与 per-meeting suppression；任一命中就丢弃。
- 弹 alert 前置 `isPromptPresented = true`；`runModal()` 返回后（defer）复位。
- Esc / Cmd-W / 关闭按钮均视为 secondary action（`.alertSecondButtonReturn`），
  不触发录音动作。

### Prompt gating（交叉判定 `recorder.state`）

不是每次 meeting 状态跨越都要弹：

| meeting 变化 | `recorder.state` | 是否弹 | 弹什么 |
|---|---|---|---|
| `false → true`（开始） | `.idle` | ✅ | "Teams 会议已开始，是否开始录音？" [Start recording] [Not now] |
| `false → true`（开始） | `.recording` | ❌ | 用户已经在录，不打扰 |
| `true → false`（结束） | `.recording` | ✅ | "Teams 会议已结束，是否停止录音？" [Stop recording] [Keep recording] |
| `true → false`（结束） | `.idle` | ❌ | 用户根本没录，不打扰 |

**读取时机**：只在收到 event 时读取一次 `recorder.state`，不做长期观察（避免因
`RecordingManager` 无 MainActor 隔离带来的读写竞争，见 [并发说明](#并发说明v1-新增来自我的补充点-b-d)）。

## Module Layout

**Scope**：新增 `apps/macos/Lyre/Meeting/` 目录 + **共享 recording action 层**
`apps/macos/Lyre/Recording/RecordingActionController.swift`（Q1 定案）；`SettingsView.swift`
追加一段；`LyreApp.swift` 加 `@State` + 接线。

```
apps/macos/Lyre/
├── Meeting/                                     # 新增
│   ├── TeamsMeetingWatcher.swift                # 检测器：轮询 + NSWorkspace 观察 + AsyncStream 发布 meeting events
│   ├── MeetingPromptCoordinator.swift           # 消费 stream + 交叉判 recorder.state → 请求 alert + 调 action controller
│   ├── MeetingDetectionSettings.swift           # UserDefaults-backed 用户开关
│   └── AlertPresenter.swift                     # NSAlert protocol + concrete impl（便于测试注入）
├── Recording/
│   └── RecordingActionController.swift          # 新增：TrayMenu + Coordinator 共享的 recording 动作入口（Q1 定案）
├── Views/
│   └── SettingsView.swift                       # 追加 "Meeting Detection" section 与开关
└── LyreApp.swift                                # 新增 @State 持有 settings/watcher/coordinator/actionController；接线；把 controller 传给 TrayMenu

apps/macos/LyreTests/
├── TeamsMeetingWatcherTests.swift               # judge / debounce / baseline 不 yield / SCK 未授权路径
├── MeetingPromptCoordinatorTests.swift          # gating / suppression / single-alert / 开关关闭
├── RecordingActionControllerTests.swift         # start/stop 顺序、store refresh、elapsed 生命周期
└── AlertPresenterTests.swift                    # 基本 double 验证（可与 coordinator 测试合并）
```

`project.yml` 无需改动（`Lyre` target 的 `sources: [path: Lyre]` 已包含全目录，见
`apps/macos/project.yml:24-25`）。

### RecordingActionController（Q1 定案，v1 新增）

**Reviewer 定案**：coordinator 不能直接调 `RecordingManager` —— tray 现在还挂了 elapsed
timer 与 `recordingsStore.refresh(url:)` 副作用；直接绕过会造成录音成功但 tray 计时不动、
Recordings 列表不刷新的可见 bug。抽 `RecordingActionController` 统一入口。

```swift
import AppKit
import Foundation
import Observation
import os

@MainActor
protocol RecordingActionHandling: AnyObject {
    var state: RecordingManager.State { get }
    func requestStart() async
    func requestStop() async
}

@Observable
@MainActor
final class RecordingActionController: RecordingActionHandling {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "RecordingActionController")

    // Owned dependencies
    let recorder: RecordingManager
    let recordingsStore: RecordingsStore
    private let alertPresenter: AlertPresenting

    // MARK: - Elapsed surface（TrayMenu 从这里读，不再自己维护 Timer）
    private(set) var elapsedDisplay: String = "00:00"
    private var elapsedTimer: Timer?

    init(recorder: RecordingManager, recordingsStore: RecordingsStore, alertPresenter: AlertPresenting) {
        self.recorder = recorder
        self.recordingsStore = recordingsStore
        self.alertPresenter = alertPresenter
    }

    var state: RecordingManager.State { recorder.state }

    func requestStart() async {
        guard recorder.state == .idle else { return }  // 并发防御，coordinator + tray 同时点也不会双开
        do {
            try await recorder.startRecording()
            startElapsedTimer()
        } catch {
            Self.logger.error("Start failed: \(error.localizedDescription)")
            alertPresenter.presentError(title: "Recording Failed", message: error.localizedDescription)
        }
    }

    func requestStop() async {
        guard recorder.state == .recording else { return }
        stopElapsedTimer()
        do {
            let url = try await recorder.stopRecording()
            await recordingsStore.refresh(url: url)
        } catch {
            Self.logger.error("Stop failed: \(error.localizedDescription)")
            alertPresenter.presentError(title: "Recording Error", message: error.localizedDescription)
        }
    }

    // MARK: - Elapsed timer (moved out of TrayMenu)
    private func startElapsedTimer() {
        elapsedDisplay = "00:00"
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateElapsedDisplay() }
        }
    }

    private func stopElapsedTimer() {
        elapsedTimer?.invalidate(); elapsedTimer = nil
        elapsedDisplay = "00:00"
    }

    private func updateElapsedDisplay() {
        let seconds = Int(recorder.elapsedSeconds)
        elapsedDisplay = String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}
```

**TrayMenu 侧改造**（同一 commit 内）：
- 移除 `elapsedTimer` / `elapsedDisplay` / `startRecording()` / `stopRecording()` 私有方法与
  自持的 `recordingsStore`；
- 改成从 `controller: RecordingActionHandling` 读 `state` + `elapsedDisplay`，按钮直接调
  `controller.requestStart()` / `controller.requestStop()`；
- `showErrorAlert` 走 `AlertPresenting`。

### AlertPresenter

```swift
import AppKit

@MainActor
protocol AlertPresenting {
    /// 弹选择型 alert，返回 true = 主按钮 (first), false = 次按钮 / 关闭 / Esc / Cmd-W
    func presentChoice(title: String, message: String, primary: String, secondary: String) -> Bool
    func presentError(title: String, message: String)
}

@MainActor
final class NSAlertPresenter: AlertPresenting {
    func presentChoice(title: String, message: String, primary: String, secondary: String) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: primary)   // .alertFirstButtonReturn
        alert.addButton(withTitle: secondary) // .alertSecondButtonReturn
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn
    }

    func presentError(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
```

**产品选择说明（Reviewer 反馈"建议调整"）**：`NSApp.activate(ignoringOtherApps: true)` 会
跨 Space 抢焦点，这是**故意的** —— 用户约束 #2 要求"直接了当"。降低骚扰的手段是压
假阳性率（Rollout Phase 4 兜底），而不是让 alert 更弱。

### TeamsMeetingWatcher（v1，用 AsyncStream，Q2 定案）

**职责**：三档轮询、`NSWorkspace` 观察、窗口识别、去抖、通过 `AsyncStream<Bool>` 只推送
**已确认的状态变化**（不推 baseline、不推 raw tick、不推重复值）。

```swift
import AppKit
import Foundation
import os
import ScreenCaptureKit

/// 抽 protocol 便于测试注入 fake app-list / window-list provider
@MainActor
protocol RunningAppsProviding {
    func isBundleRunning(anyOf ids: Set<String>) -> Bool
}

@MainActor
protocol ShareableContentProviding {
    func currentTeamsWindows(bundleIDs: Set<String>) async throws -> [ShareableWindow]
}

/// Value-type window info（SCWindow 不便构造，用轻量结构体绕开）
struct ShareableWindow: Sendable {
    let bundleID: String
    let title: String?
}

@MainActor
final class TeamsMeetingWatcher {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "TeamsMeetingWatcher")

    // MARK: - Public
    /// 只 yield 已确认的状态变化（true = 会议进入 active，false = 结束）。
    /// baseline / 重复值 / raw tick 不 yield。
    let meetingEvents: AsyncStream<Bool>

    // MARK: - Constants
    static let teamsBundleIDs: Set<String> = ["com.microsoft.teams", "com.microsoft.teams2"]
    static let meetingTitleKeywords: [String] = ["meeting", "会议", "會議"]
    static let meetingTitleSuffix: String = " | microsoft teams"
    static let excludedTitles: Set<String> = ["microsoft teams", "settings", "设置", "preferences", ""]

    private let coldInterval: TimeInterval = 30
    private let warmInterval: TimeInterval = 5

    // MARK: - Dependencies
    private let runningApps: RunningAppsProviding
    private let content: ShareableContentProviding
    private let permissions: RecordingPermissions       // 读 screenCaptureGranted
    private let clock: () -> Date                       // 允许测试注入

    // MARK: - Internal state
    private var eventContinuation: AsyncStream<Bool>.Continuation!
    private var tickTimer: Timer?
    private var launchObserver: NSObjectProtocol?
    private var terminateObserver: NSObjectProtocol?

    private enum Tier { case cold, warm, hot }
    private var tier: Tier = .cold

    /// nil = 还没跑过 baseline
    private var confirmedActive: Bool?
    /// 上一 tick 的 raw judgement，用于连续 2 tick 一致才确认切换
    private var lastRawJudgement: Bool?
    /// 是否已跑过 baseline（第一次判定用来 seed confirmedActive，不 yield）
    private var baselineDone: Bool = false
    /// SCK 未授权告警只打一次
    private var sckUnauthorizedLogged: Bool = false

    init(
        runningApps: RunningAppsProviding,
        content: ShareableContentProviding,
        permissions: RecordingPermissions,
        clock: @escaping () -> Date = Date.init
    ) {
        self.runningApps = runningApps
        self.content = content
        self.permissions = permissions
        self.clock = clock

        // .bufferingNewest(1)：alert 阻塞期间只保留最新状态，避免积压
        var cont: AsyncStream<Bool>.Continuation!
        self.meetingEvents = AsyncStream<Bool>(bufferingPolicy: .bufferingNewest(1)) { cont = $0 }
        self.eventContinuation = cont
    }

    // MARK: - Lifecycle
    func start() {
        installWorkspaceObservers()
        recomputeTier(runBaselineTickImmediately: true)
    }

    func stop() {
        tickTimer?.invalidate(); tickTimer = nil
        if let o = launchObserver { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        if let o = terminateObserver { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        launchObserver = nil; terminateObserver = nil
        eventContinuation.finish()
    }

    // MARK: - NSWorkspace observers
    private func installWorkspaceObservers() {
        let nc = NSWorkspace.shared.notificationCenter
        launchObserver = nc.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bid = app.bundleIdentifier,
                  Self.teamsBundleIDs.contains(bid) else { return }
            Task { @MainActor in self?.recomputeTier(runBaselineTickImmediately: true) }
        }
        terminateObserver = nc.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bid = app.bundleIdentifier,
                  Self.teamsBundleIDs.contains(bid) else { return }
            Task { @MainActor in self?.recomputeTier(runBaselineTickImmediately: false) }
        }
    }

    // MARK: - Tier control
    private func recomputeTier(runBaselineTickImmediately: Bool) {
        let teamsAlive = runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs)
        let newTier: Tier
        if !teamsAlive {
            newTier = .cold
            // Teams 消失 → 强制标记 inactive（如果之前 confirmed 是 true，yield 一次 false）
            if confirmedActive == true {
                confirmedActive = false
                lastRawJudgement = false
                eventContinuation.yield(false)
            } else {
                confirmedActive = false
                lastRawJudgement = false
            }
        } else {
            newTier = (confirmedActive == true) ? .hot : .warm
        }
        tier = newTier
        rescheduleTimer()
        if runBaselineTickImmediately { Task { @MainActor in self.tick() } }
    }

    private func rescheduleTimer() {
        tickTimer?.invalidate()
        let interval = (tier == .cold) ? coldInterval : warmInterval
        tickTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    // MARK: - Tick
    private func tick() {
        switch tier {
        case .cold:
            if runningApps.isBundleRunning(anyOf: Self.teamsBundleIDs) {
                recomputeTier(runBaselineTickImmediately: true)
            }
        case .warm, .hot:
            Task { @MainActor in await checkTeamsWindows() }
        }
    }

    private func checkTeamsWindows() async {
        // SCK 未授权 → 静默 inactive；一次性告警
        guard permissions.screenCaptureGranted else {
            if !sckUnauthorizedLogged {
                Self.logger.info("Screen Recording not granted; detector stays inactive")
                sckUnauthorizedLogged = true
            }
            applyDebounced(rawActive: false)
            return
        }
        do {
            let windows = try await content.currentTeamsWindows(bundleIDs: Self.teamsBundleIDs)
            applyDebounced(rawActive: judgeMeeting(from: windows))
        } catch {
            Self.logger.warning("SCK query failed: \(error.localizedDescription)")
            applyDebounced(rawActive: false)
        }
    }

    /// **内部纯函数** — 单元测试直接调这个
    static func judgeMeeting(from windows: [ShareableWindow]) -> Bool {
        let candidates = windows.filter { !excludedTitles.contains(($0.title ?? "").lowercased()) }
        if candidates.count >= 2 { return true }
        for w in candidates {
            let t = (w.title ?? "").lowercased()
            if t.hasSuffix(meetingTitleSuffix) { return true }
            for kw in meetingTitleKeywords where t.contains(kw) { return true }
        }
        return false
    }
    private func judgeMeeting(from windows: [ShareableWindow]) -> Bool {
        Self.judgeMeeting(from: windows)
    }

    // MARK: - Debounce + baseline
    private func applyDebounced(rawActive: Bool) {
        if !baselineDone {
            confirmedActive = rawActive
            lastRawJudgement = rawActive
            baselineDone = true
            // baseline 不 yield（Reviewer 反馈 #5 / Q2 定案）
            // 若 baseline 就是 active，档位升 hot
            if rawActive { recomputeTier(runBaselineTickImmediately: false) }
            return
        }

        // 连续 2 tick 一致才确认
        if lastRawJudgement == rawActive && confirmedActive != rawActive {
            confirmedActive = rawActive
            eventContinuation.yield(rawActive)
            recomputeTier(runBaselineTickImmediately: false)
        }
        lastRawJudgement = rawActive
    }
}
```

**关键点**：
- **`meetingEvents` 只 yield 已确认的状态变化**（Q2 定案 + Reviewer 反馈 #5）。baseline
  首次判定只 seed `confirmedActive`，**绝不 yield**。测试可以直接读 stream 断言 yield 序列。
- **`.bufferingNewest(1)`**（Q2 定案）：alert 阻塞期间只保留最新状态，避免积压过时事件。
- **Provider 抽象**（Reviewer 反馈 #3）：`RunningAppsProviding` / `ShareableContentProviding`
  两个 protocol 让 fake 直接注入 tick 序列，测试不依赖真 Teams。
- **纯函数 `Self.judgeMeeting(from:)`**（Reviewer 反馈 #3）：`SCWindow` 无法直接构造，把
  判据抽成 static 接受 `[ShareableWindow]`，单元测试直接调。
- **SCK 未授权路径**（Reviewer 反馈 #4）：不调用 SCK API、不弹引导、一次性告警。
- **Swift 6 隔离**：类整体 `@MainActor`；provider protocol 也是 `@MainActor`；
  `NSWorkspace` observer closure 通过 `Task { @MainActor in ... }` 桥回主 actor；
  `Timer.scheduledTimer` 同样桥回。**方案写死为 `Timer + Task { @MainActor }`**，
  不留 `DispatchSourceTimer` / `AsyncTimerSequence` 备选路径（我的补充点 D 定案）。

### MeetingPromptCoordinator（v1，用 for-await 消费 stream）

**职责**：消费 `watcher.meetingEvents`，读一次 `recorder.state`（快照，避免观察），
按 gating / suppression / single-alert 规则调 `AlertPresenting` + `RecordingActionHandling`。

```swift
import Foundation
import os

@MainActor
final class MeetingPromptCoordinator {
    private static let logger = Logger(subsystem: Constants.subsystem, category: "MeetingPromptCoordinator")

    private let watcher: TeamsMeetingWatcher
    private let action: RecordingActionHandling
    private let alertPresenter: AlertPresenting
    private let settings: MeetingDetectionSettings

    private var task: Task<Void, Never>?
    /// 单 alert 在场标记（Reviewer 反馈 #6）
    private var isPromptPresented: Bool = false
    /// 每场会议的抑制标记
    private var startPromptShownForCurrentMeeting: Bool = false
    private var stopPromptShownForCurrentMeeting: Bool = false

    init(
        watcher: TeamsMeetingWatcher,
        action: RecordingActionHandling,
        alertPresenter: AlertPresenting,
        settings: MeetingDetectionSettings
    ) {
        self.watcher = watcher
        self.action = action
        self.alertPresenter = alertPresenter
        self.settings = settings
    }

    func start() {
        task = Task { @MainActor [weak self] in
            guard let stream = self?.watcher.meetingEvents else { return }
            for await active in stream {
                await self?.handle(active: active)
            }
        }
    }

    func stop() { task?.cancel(); task = nil }

    private func handle(active: Bool) async {
        guard settings.isEnabled else { return }
        guard !isPromptPresented else { return }  // single-alert 规则

        if active {
            // false → true：会议开始（一场新会议 → 重置本场抑制）
            startPromptShownForCurrentMeeting = false
            stopPromptShownForCurrentMeeting = false
            guard action.state == .idle else { return }
            if startPromptShownForCurrentMeeting { return }
            startPromptShownForCurrentMeeting = true
            await promptStart()
        } else {
            // true → false：会议结束
            guard action.state == .recording else { return }
            if stopPromptShownForCurrentMeeting { return }
            stopPromptShownForCurrentMeeting = true
            await promptStop()
        }
    }

    private func promptStart() async {
        isPromptPresented = true
        defer { isPromptPresented = false }
        let start = alertPresenter.presentChoice(
            title: String(localized: "Teams meeting detected"),
            message: String(localized: "Start recording this meeting?"),
            primary: String(localized: "Start Recording"),
            secondary: String(localized: "Not now")
        )
        if start { await action.requestStart() }
    }

    private func promptStop() async {
        isPromptPresented = true
        defer { isPromptPresented = false }
        let stop = alertPresenter.presentChoice(
            title: String(localized: "Teams meeting ended"),
            message: String(localized: "Stop recording?"),
            primary: String(localized: "Stop Recording"),
            secondary: String(localized: "Keep Recording")
        )
        if stop { await action.requestStop() }
    }
}
```

**关键点**：
- **消费 `AsyncStream`**（Q2 定案）：无 `withObservationTracking`、无 continuation
  竞争问题，事件模型确定且可测试（在测试里给 watcher 塞 fake events）。
- **只读快照** `action.state`（我的补充点 B）：不长期观察 `recorder.state`，避免与
  `RecordingManager` 的 non-MainActor 状态发生竞争。
- **不直接碰 `RecordingManager`**（Reviewer 反馈 #1 + Q1 定案）：全部通过
  `RecordingActionHandling`。
- **Esc / Cmd-W / 关闭 = secondary action**（Reviewer 反馈 #6）：`NSAlert.runModal()` 对
  这些用户交互都返回非 `.alertFirstButtonReturn`，`presentChoice` 返回 `false`，
  不触发录音。

### MeetingDetectionSettings

```swift
import Foundation
import Observation

@Observable
@MainActor
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

**关闭开关后的行为**（Reviewer 反馈"建议调整"）：
- **Coordinator 不再弹提示**（handle 首行 guard）。
- **Watcher 保持运行但降到 cold 档并停 SCK 查询**：为了避免"关掉功能仍有 SCK 权限压力"，
  开关关闭时 `MeetingPromptCoordinator` 除了不弹之外，还调 `watcher.stop()` 完全停止
  轮询；重新开启时 `watcher.start()`。文档明确：**关掉开关 = detector 完全停机**，
  静态功耗归零，与 Teams 未安装等价。

### SettingsView 追加（v1 修订，Reviewer 反馈 #2）

在现有 `apps/macos/Lyre/Views/SettingsView.swift`（**注意：不是不存在的 `Views/Settings/GeneralSettingsView.swift`**）内追加一个 Section：

```swift
Section("Meeting Detection") {
    Toggle(
        "Detect Teams meetings and prompt to record",
        isOn: $meetingSettings.isEnabled
    )
    Text("When enabled, Lyre pops up a small confirmation when a Microsoft Teams meeting starts or ends. Lyre never starts or stops recording without your confirmation.")
        .font(.caption)
        .foregroundStyle(.secondary)
}
```

`SettingsView` 签名扩展一个 `@Bindable var meetingSettings: MeetingDetectionSettings`。

### LyreApp 接线（v1 明确，Reviewer 反馈 #2）

需要新增的 `@State`：
- `meetingSettings: MeetingDetectionSettings`
- `meetingWatcher: TeamsMeetingWatcher`
- `meetingCoordinator: MeetingPromptCoordinator`
- `actionController: RecordingActionController`
- `alertPresenter: AlertPresenting`（NSAlertPresenter 实例）

`init()` 顺序：
```swift
init() {
    let cfg = AppConfig()
    let mgr = RecordingManager()
    mgr.outputDirectory = cfg.outputDirectory
    let store = RecordingsStore(directory: cfg.outputDirectory)
    let presenter = NSAlertPresenter()
    let action = RecordingActionController(recorder: mgr, recordingsStore: store, alertPresenter: presenter)

    let mtgSettings = MeetingDetectionSettings()
    let watcher = TeamsMeetingWatcher(
        runningApps: NSWorkspaceRunningAppsProvider(),
        content: SCShareableContentProvider(),
        permissions: mgr.permissions
    )
    let coord = MeetingPromptCoordinator(
        watcher: watcher,
        action: action,
        alertPresenter: presenter,
        settings: mtgSettings
    )

    if mtgSettings.isEnabled {
        watcher.start()
        coord.start()
    }

    _config = State(initialValue: cfg)
    _recorder = State(initialValue: mgr)
    _recordingsStore = State(initialValue: store)
    _actionController = State(initialValue: action)
    _meetingSettings = State(initialValue: mtgSettings)
    _meetingWatcher = State(initialValue: watcher)
    _meetingCoordinator = State(initialValue: coord)
    _alertPresenter = State(initialValue: presenter)
}
```

TrayMenu 改成从 `actionController` 拿 state / elapsedDisplay / requestStart / requestStop。
`SettingsView` 传入 `meetingSettings` 用于 Section 开关；开关的 `didSet` 应该驱动
watcher/coordinator 的 start/stop，具体接线放在 LyreApp 的 `.onChange(of: meetingSettings.isEnabled)`。

### 并发说明（v1 新增，来自我的补充点 B/D）

- `TeamsMeetingWatcher` / `MeetingPromptCoordinator` / `RecordingActionController` /
  `AlertPresenting` 全部 `@MainActor` 隔离，避开 Swift 6 strict concurrency 的 Sendable 报错。
- `RecordingManager` 现状是 `@unchecked Sendable` 且没有 MainActor 隔离，`state` 是
  `internal(set) var`。**Coordinator 与 Controller 只在 MainActor 上读**（`action.state`
  快照），不长期观察，避免与录音线程的写发生竞争。start/stop 通过 controller 上的 async
  函数触发，controller 内部 `await recorder.startRecording()` —— 与目前 TrayMenu 的用法
  一致（`RecordingManager.startRecording` 本身是 async throws）。
- `Timer.scheduledTimer` closure 在 main run loop 上，但**不是 MainActor-isolated**；
  统一走 `Task { @MainActor in ... }` 桥接，方案写死不做 DispatchSourceTimer 备选。
- **所有 Logger 都用 `Constants.subsystem`**（补充点 A），不硬编码 `"ai.hexly.lyre"`。

## Design Principles

1. **Teams-only, single detector**：一个 `TeamsMeetingWatcher`，不做通用 `MeetingObserver` 抽象。
2. **No new permissions**：只用 SCK（已有，未授权时静默）+ NSWorkspace（免费）。
3. **Cold path 零 IPC**：Teams 未运行时 30s tick 只读 `runningApplications`。
4. **Prompt only, never act**：只弹对话框；录音启停统一走 `RecordingActionController`。
5. **Debounce > accuracy**：宁可延迟 5–10s 发提示，也不弹后立刻收回。
6. **Per-meeting suppression + single-alert**：一场会议内每种提示最多一次；alert 打开
   期间新 event 直接丢弃。
7. **Baseline 静默**：启动时的会议状态只作 baseline，不弹提示；哥要的"启动时也提示"若
   将来需要，走独立 first-change event，不动去抖流程。
8. **Off-switch = full stop**：关掉开关 = detector 完全停机（watcher stop + coord stop）。
9. **Testable seams**：provider protocol + AlertPresenter + RecordingActionHandling +
   AsyncStream。测试无 Teams / 无 SCK / 无真 alert 依赖。

## Testing Strategy

### Unit tests

| 测试 | 操作 |
|---|---|
| `TeamsMeetingWatcherTests.judgeMeeting_count` | 构造 `[ShareableWindow(bid: teams2, title: "Microsoft Teams"), ShareableWindow(bid: teams2, title: "Meeting in Sprint \| Microsoft Teams")]` → `Self.judgeMeeting == true`（数量 >=2 排除主窗口后是 1，但会议标题匹配也命中） |
| `TeamsMeetingWatcherTests.judgeMeeting_keyword` | 单窗 title `"会议：产品评审"` → true；`"讨论 \| Microsoft Teams"` → true；`"Random Chat"` → false |
| `TeamsMeetingWatcherTests.judgeMeeting_exclude` | 两窗 title 都是 `"Microsoft Teams"` / `"Settings"` → 排除后 candidates=0 → false |
| `TeamsMeetingWatcherTests.baseline_does_not_yield` | Fake providers 让首次 tick 判 true → `meetingEvents` 30ms 内**无** yield，`confirmedActive == true`（读取内部 seam 或通过后续状态验证） |
| `TeamsMeetingWatcherTests.debounce_switch` | 序列 `[true, false, true, true]` → yield 序列应为 `[]`（前 3 tick 都在两两不一致中，第 4 tick `lastRaw==true && confirmed(baseline=true)!=true` 也不动） → 更换测试案例：baseline=false，然后 `[true, true]` → yield `[true]`；再 `[false, false]` → yield `[false]` |
| `TeamsMeetingWatcherTests.sck_unauthorized_silent` | Fake permissions `screenCaptureGranted = false` → tick 不调 SCK provider，`sckUnauthorizedLogged` 只置位一次，`confirmedActive == false` |
| `TeamsMeetingWatcherTests.teams_terminate_forces_false` | baseline=true → NSWorkspace 触发 didTerminate → 立即 yield `false` |
| `MeetingPromptCoordinatorTests.start_prompt_gating_idle` | action.state=.idle → 塞一个 true event → `presenter.presentChoice` 被调一次，参数为 start prompt 文案；返回 true → `action.requestStart` 被调 |
| `MeetingPromptCoordinatorTests.no_start_when_recording` | action.state=.recording → 塞 true event → 不调 presenter |
| `MeetingPromptCoordinatorTests.no_stop_when_idle` | action.state=.idle → 塞 false event → 不调 presenter |
| `MeetingPromptCoordinatorTests.one_prompt_per_meeting` | idle → 塞 true → 弹一次；再塞 true → 不弹（同一场会议内被抑制） |
| `MeetingPromptCoordinatorTests.single_alert_gate` | 让 presenter 的 `presentChoice` 阻塞 → 期间塞第二个 event → 不弹第二次；presenter 返回后再塞事件走正常流程 |
| `MeetingPromptCoordinatorTests.settings_disabled_silent` | settings.isEnabled=false → 塞事件 → 不弹（并且不改变 lastObservedActive，因为 v1 已改为"关掉 = watcher 完全停机"，coordinator 内不再需要跟踪 lastObservedActive） |
| `RecordingActionControllerTests.start_updates_elapsed` | requestStart 成功 → elapsedTimer 启动、elapsedDisplay 更新序列可观察 |
| `RecordingActionControllerTests.stop_refreshes_store` | requestStop 成功 → recordingsStore.refresh 被调，参数是 recorder 返回的 URL |
| `RecordingActionControllerTests.start_alerts_on_error` | mock recorder 抛错 → alertPresenter.presentError 被调 |
| `RecordingActionControllerTests.double_start_is_noop` | recorder.state=.recording → requestStart 直接 return，不调 recorder.startRecording |
| `AlertPresenterTests`（optional） | 保持 NSAlertPresenter 只是薄封装；如引入正式测试，用 UI test 或跳过 |

**注入策略**：
- `TeamsMeetingWatcher`：`RunningAppsProviding` / `ShareableContentProviding` /
  `RecordingPermissions` 全 protocol 注入。
- `MeetingPromptCoordinator`：`AlertPresenting` / `RecordingActionHandling` /
  `MeetingDetectionSettings` 全 protocol / concrete-with-defaults 注入；watcher 传一个
  fake watcher，暴露 `feedEvent(_ active: Bool)` 直接向 stream yield。
- `RecordingActionController`：`RecordingManager` 因为是 concrete final class，测试里
  用一个 lightweight subclass override + `internal(set)` 状态直接改；或者引入
  `RecordingLifecycle` protocol 但 v1 优先保留 controller 直持 concrete manager（协议
  仅在必要时抽出）。

### Manual acceptance（release 前必跑）

1. **DQ-1 Teams 不运行时功耗**：Lyre 启动、Teams 完全关闭。Activity Monitor 观察 Lyre
   进程 30 分钟 —— CPU < 0.1%。
2. **DQ-2 打开 Teams 立即入会**：Teams 冷启 → 立刻 Join → 15 秒内弹 "Start recording"。
3. **DQ-3 会议中启动 Lyre**：已在会议中 → 启动 Lyre → **不弹**（baseline 静默）。托盘正常
   显示，用户可手动 Start Recording。
4. **DQ-4 假阳性**：Teams 打开 Chat 独立窗口、Calendar 弹窗 → 观察误弹率。>1/day 则收紧判据。
5. **DQ-5 会议结束提示**：录音中，主持人 End Meeting → 5–15 秒内弹 "Stop recording"。
6. **DQ-6 关掉开关**：Settings 关掉 → 开会不弹，且 Activity Monitor 上 watcher 完全停机
   （无 5s SCK 查询）。重新开启 → 下一场会议正常弹。
7. **DQ-7 SCK 未授权**：临时撤销 Screen Recording → Teams 中开会 → 不弹、无骚扰、日志
   最多 1 条 info。重新授予 → 下一场会议正常弹。
8. **DQ-8 Single-alert**：弹起 Start prompt 后立即结束会议（人为在 Teams 里 leave）→
   Stop prompt 不重叠出现；Start prompt 关闭后如仍 inactive，不再弹 Stop（因为 Start
   prompt 期间的 true→false 变化被 buffering 1 覆盖掉）。**明确记录此行为为 by-design**：
   丢弃优先于叠加。
9. **DQ-9 录音入口一致性**：tray Start / detector Start / tray Stop / detector Stop
   四种组合各录一段 → Recordings 列表都能立即刷新、tray 计时器都能起停。

## Compatibility & Migration

- **macOS minimum**：15.0（`project.yml:5` 已固化）。
- **权限**：不新增。SCK 未授权时 detector 静默。
- **老用户**：默认开启（首装机 `isEnabled = true`）。
- **Teams 未安装**：cold 档持续，无提示，无影响。
- **测试环境**：Provider protocol + AlertPresenter + AsyncStream，无外部依赖。

## Risk & Fallback

| 风险 | 触发条件 | 降级 |
|---|---|---|
| 窗口标题格式再次变化 | Microsoft 改 New Teams 会议窗口标题 | 数量判据仍生效；DQ-4 定期回归 |
| SCK 权限被撤销 | 用户在系统设置撤销 Screen Recording | 一次性告警 + 静默 inactive；录音本身仍走现有引导 |
| Alert 被埋（Teams 全屏 + 另一 Space） | 见 [AlertPresenter](#alertpresenter) | `NSApp.activate(ignoringOtherApps: true)` 前置；产品选择"直接了当" |
| 假阳性太多 | DQ-4 发现率高 | 收紧 `excludedTitles` 或改用严格标题判据；预留 Phase 4 |
| Teams 崩溃 → 进程还在但无窗口 | 极少见 | warm tick 检测不到窗口 → 平滑降 inactive → 若正在录音会弹 Stop prompt，用户按 Keep recording 即可 |
| 抖动导致 miss stop prompt | Start prompt 弹开阻塞时会议结束 | 由 `.bufferingNewest(1)` 决定：只丢一次；用户可从 tray 手动 stop（DQ-9 已确保入口一致） |

## Non-goals

- **不做 Zoom / Meet / Webex**。
- **不做日历集成**。
- **不主动开录 / 停录**。
- **不做转录 / 摘要触发**。
- **不持久化会议历史**。
- **不做通用 `MeetingObserver` 抽象**。
- **不用 UserNotifications 横幅通知** —— 用户明确要模态对话框。
- **不做 detector 层的 SCK 权限引导** —— 引导只在录音路径出现。

## Rollout — 原子化提交计划（v1 修订，Reviewer 反馈 #7）

按以下顺序**逐 commit 提交到 main**，每个 commit 独立可通过 `xcodegen generate` +
`xcodebuild -scheme Lyre -destination 'platform=macOS' build` +
`xcodebuild -scheme Lyre -destination 'platform=macOS' test` +
`swiftlint lint apps/macos/Lyre/`。

| # | Commit | 内容 | 验证 |
|---|--------|------|------|
| C1 | `docs(macos): draft teams meeting detector spec` | 现有 `docs/07-teams-meeting-detector.md` v0（已提交 `3d600f9`） | 文档评审 |
| C2 | `docs(macos): refine teams detector spec after joint review` | 本文档 v1 | 文档评审 |
| C3 | `chore(macos): capture teams window shape probe results` | Phase 0 探针脚本 + 附录（Teams 主/会议/Chat/Settings/Calendar 窗口 title 观察值），落到 docs/07 附录 | 文档 review |
| C4 | `refactor(macos): extract RecordingActionController for tray + detector` | 新增 `Recording/RecordingActionController.swift` + `Meeting/AlertPresenter.swift`；把 tray 现有 elapsed timer / store refresh / error alert 迁进 controller；TrayMenu 改成从 controller 读取 & 调用；`LyreApp` 在 init 里构造 controller 并传入 tray | `xcodebuild build & test`（不新增测试就位，但现有 tray/manager 测试仍绿）；本机手动录一段验证 tray 显示、Recordings 刷新 |
| C5 | `feat(macos): add meeting detection settings + settings ui toggle` | `Meeting/MeetingDetectionSettings.swift` + `SettingsView.swift` 追加 Section + `LyreApp` 持有 `MeetingDetectionSettings` 并传入 `SettingsView` | `xcodebuild build`；打开 Settings 看到开关 |
| C6 | `feat(macos): add teams meeting watcher with provider seams` | `Meeting/TeamsMeetingWatcher.swift` + `Meeting/ShareableWindow.swift` + 两个 provider concrete impl；新增 `TeamsMeetingWatcherTests` 全部用例（judge / debounce / baseline / SCK 未授权 / didTerminate 强制 false） | `xcodebuild test` — 新测试全绿 |
| C7 | `feat(macos): add prompt coordinator with alert presenter tests` | `Meeting/MeetingPromptCoordinator.swift` + 复用 `AlertPresenter.swift`；`MeetingPromptCoordinatorTests` 全部用例；测试用 fake watcher + fake presenter + fake action | `xcodebuild test` — 新测试全绿 |
| C8 | `feat(macos): wire meeting detector into LyreApp with off-switch handling` | `LyreApp.swift` 构造 watcher/coordinator，`onChange(of: meetingSettings.isEnabled)` 驱动 start/stop；DQ-1/DQ-6 打点 log | `xcodebuild build & test`；DQ-1/DQ-6 手动 |
| C9 | `docs(macos): record DQ manual acceptance results` | DQ-1 到 DQ-9 手工验收记录写入 docs/07 附录；若发现假阳性率高，跟随一个 tightening commit | 文档 review |
| C10（条件） | `feat(macos): tighten meeting judgement heuristic` | 只有 DQ-4 假阳性率高时才提；调整 `excludedTitles` 或改用严格标题判据 | 相应新单测 + `xcodebuild test` |
| C11 | `chore: update CLAUDE.md retrospective (if any macOS API learnings)` | 若 C6/C7/C8 学到 `SCShareableContent` / `AsyncStream` / `NSAlert` 的坑，写到 retrospective | — |

**约束**：
- 每个 commit 都必须能过 pre-commit hook（`xcodebuild` + `swiftlint`）；C4 之后每步都
  需要至少能 build。
- 不在 C4 之外的 commit 里做 tray refactor，避免 diff 混杂；detector 相关代码集中在
  C5-C8。
- C4 是承载 Reviewer #1 修正的关键；如 C4 复审发现 tray 显示回归，先滚回 C4 再往下走。
- C6/C7 的测试必须 100% 绿才能进入 C8。

## References

- Apple — [`SCShareableContent`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent)
- Apple — [`NSWorkspace.runningApplications`](https://developer.apple.com/documentation/appkit/nsworkspace/1534059-runningapplications)
- Apple — [`NSAlert`](https://developer.apple.com/documentation/appkit/nsalert)
- Apple — [`AsyncStream`](https://developer.apple.com/documentation/swift/asyncstream)
- Apple — [Observation framework](https://developer.apple.com/documentation/observation)
- [yazinsai/OpenOats — `MeetingDetector.swift`](https://github.com/yazinsai/OpenOats) — 参考"进程 + SCK 窗口"双判据思路
- [RecapAI/Recap — `AudioProcess.swift`](https://github.com/RecapAI/Recap) — bundle ID 白名单模式
- Granola [Permissions FAQ](https://docs.granola.ai/help-center/getting-started/setting-up-granola-for-the-first-time) — "不需要 Accessibility 也能做会议感知"的产品先例

## 审查记录

### v0 → v1 修订项

来自 @MBP-Reviewer-A 2026-07-06 首轮审查（本 lyre-teams 线程 msg=6e6d64d4）+ 我的独立扫码
补充 A-D + 联合 Q1/Q2 定案，全部合并：

1. **抽 `RecordingActionController`（Q1 定案）** — 解决 detector 绕过 tray 现有副作用
   （elapsed timer、`recordingsStore.refresh`）导致 UI 不同步的 bug。TrayMenu 和
   Coordinator 都走 `RecordingActionHandling` protocol；controller 由 LyreApp 拥有。
2. **Settings 路径与接线** — 撤销不存在的 `Views/Settings/GeneralSettingsView.swift`；
   改到现有 `Views/SettingsView.swift` 追加 Section；LyreApp 明确列出所有新增 `@State`。
3. **测试 seam** — Provider protocol（`RunningAppsProviding` / `ShareableContentProviding`）
   + `AlertPresenting` + `RecordingActionHandling`；watcher 判据抽 static
   `judgeMeeting(from:)`。
4. **SCK 未授权路径** — 静默 inactive、一次性告警、不主动拉引导、不弹会议提示。
5. **启动语义统一** — Baseline 只 seed 内部状态，不 yield；启动时会议中不弹。相关表述
   全部改成 baseline-first。
6. **Single-alert 在场规则** — `isPromptPresented` gate + `.bufferingNewest(1)`；Esc /
   Cmd-W / 关闭均为 secondary action。
7. **原子提交拆分** — C1-C11 明细表（含 C10 条件 commit）；每个 commit 写出验证命令。

我额外补充的：
- **A.** Logger subsystem 统一 `Constants.subsystem`，不硬编码。
- **B.** Coordinator 只读 `action.state` 快照，不长期观察，避免与 non-MainActor
  `RecordingManager` 竞争。
- **C.** 用 `AsyncStream` 替代 `withObservationTracking`，解决 Observation one-shot
  在同一 run loop tick 内漏事件的脆弱性（Q2 定案）。
- **D.** Timer 方案写死 `Timer + Task { @MainActor in ... }`，不留 `DispatchSourceTimer` /
  `AsyncTimerSequence` 备选路径。
- **开关关掉 = watcher 完全停机**（对齐 Reviewer "建议调整"）：coordinator 观察
  `settings.isEnabled` 变化 → 停 watcher；重新开启 → 起 watcher。detector 静态功耗归零。

---

v1 敲定后按 C3 起进入实现阶段。
