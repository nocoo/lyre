# macOS UI Basalt Upgrade — Execution Plan

> 落地 `docs/07-macos-ui-basalt-upgrade.md` 的具体任务分解，每个任务
> = 一个原子提交，带明确的验收和验证步骤。

## Dependency Graph

```
Spacing ─────┐
Radius ──────┤
Color+Hex ───┘
             │
       Palette ──── PaletteEnvironment ──── LyreApp root injection ──┐
             │                                                        │
             ├─── BasaltFont                                          │
             └─── BasaltMotion                                        │
                                                                      ↓
                                       Surfaces (basaltCard/Field/Shadow)
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ↓                ↓                ↓
                            EmptyStateCard      PhaseBadge      (页面直接消费)
                                    │                │
                                    ↓                ↓
                             RecordingsView       UploadView
                                                  SettingsView
                                              PermissionGuideView
                                                    AboutView
```

## Slicing 策略

**垂直切片**：每个任务都是**一个可运行、可验收的最小闭环**。

- **Stage 1** 是一个"垂直切片包"：所有 Theme token 文件一次性齐全 +
  LyreApp 注入 + 单测，才有意义（少一个文件 palette 就断链）。作为
  **1 个原子提交**。
- **Stage 2** 分 3 个提交：`Surfaces`、`EmptyStateCard`、`PhaseBadge` —
  每个独立消费面，独立可编译，独立可 rollback。
- **Stage 3** 每个页面 **1 个原子提交**，共 6 个页面。页面之间**零耦合**，
  可以并行 review，rollback 单个页面不影响其他。

## Atomic Commit Plan

### Stage 1 — Token 骨架

#### C1: `feat(macos): add Basalt token layer + LyreApp palette injection`

**范围**：一次性添加 Theme 层所有文件 + LyreApp 根注入，零视觉变化。

**新增文件**：

- `apps/macos/Lyre/Theme/Spacing.swift`
- `apps/macos/Lyre/Theme/Radius.swift`
- `apps/macos/Lyre/Theme/Color+Hex.swift`
- `apps/macos/Lyre/Theme/Palette.swift`（含橙色 accent `#F58A2A` / `#FFA054`）
- `apps/macos/Lyre/Theme/PaletteEnvironment.swift`
- `apps/macos/Lyre/Theme/BasaltFont.swift`（全部 `.system(role, design:)`，
  无固定 `size:`）
- `apps/macos/Lyre/Theme/BasaltMotion.swift`
- `apps/macos/LyreTests/BasaltTokenTests.swift`

**修改文件**：

- `apps/macos/Lyre/LyreApp.swift` — 在 `Window("Lyre", id: "main") { MainWindowView(…) }`
  的 `MainWindowView` 上注入 `.environment(\.palette, Palette.resolved(scheme))`
  （需要在 `LyreApp` 里加 `@Environment(\.colorScheme) private var scheme`）。
  `MenuBarExtra` 里的 `TrayMenu` 保持系统外观（不注入，menu bar 是 vibrancy 语义）

**Acceptance**：

1. `xcodebuild build -project Lyre.xcodeproj -scheme Lyre` 成功
2. `xcodebuild test -scheme Lyre` 全绿（含新增 suite）
3. `swiftlint --strict apps/macos/Lyre/ apps/macos/LyreTests/` 0 violations
4. 手工启 App：4 个 tab 视觉**完全无变化**（无 view 消费 palette）
5. `grep -rn "Font\.system(size:" apps/macos/Lyre/Theme/` 返回空
6. `BasaltTokenTests` 至少 3 个 test 通过：
   - `palette_L0_L1_L2_luminanceOrder_light` — Light mode 亮度递增
   - `palette_L0_L1_L2_luminanceOrder_dark` — Dark mode 亮度递增
   - `basaltFont_renders_at_extreme_dynamicTypeSizes` — `DemoView` 在
     `.xSmall` / `.large` / `.accessibility3` 三档下求值 `body` 不 crash

**验证步骤**：

```bash
cd apps/macos && xcodegen generate
xcodebuild build -project Lyre.xcodeproj -scheme Lyre -configuration Debug \
  -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
xcodebuild test -project Lyre.xcodeproj -scheme Lyre -configuration Debug \
  -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
swiftlint lint --strict Lyre/ LyreTests/
grep -rn "Font\.system(size:" Lyre/Theme/  # must be empty
```

**风险**：低。纯新增文件 + 根注入。回滚方式：`git revert`。

---

### CHECKPOINT ✅ Stage 1

- [ ] C1 合并后手工过一遍 4 个 tab，确认视觉零变化
- [ ] 确认 `xcodegen generate` 已把新 Theme/ 目录扫入 project
- [ ] 确认 `elapsedTimer` 审计结果：`stopElapsedTimer()` 只在 stopRecording
      路径调用；tray menu 无 onDisappear。**审计结论**：录音中直接 Quit
      会泄漏 timer，但进程即将退出所以无影响；**不修**。写在 C10 的
      Swift 源码注释里作为技术债标记；**不进 CHANGELOG / Release notes**
      （这是内部生命周期审计，不是用户可见变更）

Stage 1 pass 后再进 Stage 2。

---

### Stage 2 — Surfaces + Components

#### C2: `feat(macos): add basaltCard / basaltField / basaltShadow surface modifiers`

**范围**：三个 View extension modifier，配套 tests。

**新增文件**：

- `apps/macos/Lyre/Theme/Surfaces.swift` — `basaltCard(radius:)` /
  `basaltField(radius:)` / `basaltShadow()`
- `apps/macos/LyreTests/BasaltSurfacesTests.swift`

**Acceptance**：

1. 三个 modifier 独立编译通过
2. Tests：一个 `DemoStack` view 挂三个 modifier，body 求值不 crash（无 snapshot 库）
3. **Lyre 项目对 B-6 阴影默认的克制覆盖**：`basaltShadow` 用 3 层 `.shadow`
   叠加 `0.5px + 3px + 8px`（而非 B-6 默认的 `0.5px + 6px + 18px`）—
   macOS 菜单栏工具视觉要更贴地，避免 web dashboard 卡片墙感
4. **Lyre 项目对 B-6 radius 默认的克制覆盖**：`basaltCard` 默认 radius =
   `Radius.widget` (10)（而非 B-6 默认的 `Radius.card = 14`）—
   `Radius.card / island` 常量仍在 Token 层保留（未来页面级容器需要更大
   圆角时可显式指定），但**本次 rollout 全部页面统一走 widget (10)**
5. `basaltField` 默认 radius = `Radius.widget` (10)
6. Modifier 内部通过 `@Environment(\.palette)` 消费色板

**验证步骤**：

```bash
cd apps/macos && xcodebuild test -project Lyre.xcodeproj -scheme Lyre \
  -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
swiftlint lint --strict Lyre/Theme/Surfaces.swift LyreTests/BasaltSurfacesTests.swift
```

**风险**：低。零 view 消费。

---

#### C3: `feat(macos): add EmptyStateCard component`

**范围**：RecordingsView 空态用的容器组件。

**新增文件**：

- `apps/macos/Lyre/Components/EmptyStateCard.swift`
- `apps/macos/LyreTests/EmptyStateCardTests.swift`

**签名（示意）**：

```swift
public struct EmptyStateCard: View {
    let systemImage: String
    let title: String
    let subtitle: String?
    // body: SF Symbol 40pt + BasaltFont.cardTitle + BasaltFont.body
    //       + palette.mutedSubtle + basaltCard()
}
```

**Acceptance**：

1. 独立编译通过
2. `accessibilityLabel` = `title`，`accessibilityValue` = `subtitle`（VoiceOver
   一次读全）
3. Test：无 subtitle / 有 subtitle 两种构造都 body 求值不 crash
4. 内部用 `BasaltFont.cardTitle` + `BasaltFont.body`，不出现固定 `size:`

**验证步骤**：同 C2。

**风险**：低。

---

#### C4: `feat(macos): add PhaseBadge component`

**范围**：UploadView 上传阶段的状态标签。

**新增文件**：

- `apps/macos/Lyre/Components/PhaseBadge.swift`
- `apps/macos/LyreTests/PhaseBadgeTests.swift`

**签名（示意）**：

```swift
public struct PhaseBadge: View {
    public enum Phase: Equatable {
        case pending(String)
        case running(String)     // spinner + label
        case succeeded(String)   // checkmark + label
        case failed(String)      // triangle + label
    }
    let phase: Phase
    // body: HStack { icon + Text } + pill-shape background at phaseColor.opacity(0.12)
}
```

**Acceptance**：

1. 4 个 phase 独立编译 + body 求值不 crash
2. 颜色映射：pending → `palette.muted`；running → `palette.accent`；
   succeeded → `palette.success`；failed → `palette.destructive`
3. `accessibilityLabel` 表达"是什么"，`accessibilityValue` 表达当前状态
4. **不主动播报** —— 静态可访问性即可（VoiceOver 遍历时读全）
5. failed 用 `exclamationmark.triangle.fill`；succeeded 用
   `checkmark.circle.fill`；running 用 `ProgressView().controlSize(.small)`；
   pending 用 `circle.dotted`

**验证步骤**：同 C2。

**风险**：低。

---

### CHECKPOINT ✅ Stage 2

- [ ] C2 / C3 / C4 全 merge 后 `xcodebuild test` 全绿
- [ ] 手工启 App：视觉仍**零变化**（无 view 消费）
- [ ] `grep -rn "\.frame(height:" apps/macos/Lyre/Components/` 人工审查每处
      是否会锁 Dynamic Type

Stage 2 pass 后再进 Stage 3。

---

### Stage 3 — 逐页面 Rollout

**顺序原则**：先做 RecordingsView 验证方向（最高频页面），随后按依赖 +
用户可见度排序。**每个页面独立 commit** — 单页 rollback 不影响其他页。

#### C5: `feat(macos): apply Basalt palette to RecordingsView`

**修改文件**：`apps/macos/Lyre/Views/RecordingsView.swift`

**具体动作**（对齐 spec §RecordingsView）：

1. `emptyState` 换 `EmptyStateCard(systemImage: "waveform.circle", title:
   "No Recordings", subtitle: "…")`
2. `RecordingRow`（`:187`）视觉改造：
   - **播放按钮（保守方案，默认）**：保持原 28pt SF Symbol 尺寸和结构，
     只把颜色从硬编码 `.orange` / `.accentColor` 换成 `palette.accent`。
     **不加** `.symbolEffect` 类动画 —— 如未来要加，必须先 gate 于
     `@Environment(\.accessibilityReduceMotion)`（对齐 docs/07 §动效规范）；
     本次范围内保持静态。**不改容器形状 / 不引入 44pt 圆背景** —— macOS
     List row 密度对大按钮敏感，改结构会拉长 row 降低扫描效率
   - **升级方案（仅当截图对比确实需要更强视觉锚点时启用）**：44pt 圆容器
     `Circle().fill(palette.input)` + `palette.accent` 图标；播放中态改
     `Circle().fill(palette.accent)` + 白色图标。**这是 fallback，不是
     默认路径** —— 先跑保守方案，截图 review 后决定是否升级
   - 时间/大小/日期 `Label` (`.caption`) → `BasaltFont.caption` +
     `palette.muted`
   - 当前播放时长 `Text(formatTime(...)).font(.caption.monospacedDigit())` →
     `BasaltFont.mono` + `palette.muted`
3. `recordingsList` 加 `.scrollContentBackground(.hidden)` +
   `.background(palette.bg)`
4. toolbar batch delete `.foregroundStyle(.red)` → 移除颜色覆盖，配
   `role: .destructive`（`Button(role: .destructive)` 由系统给红色）
5. `List(selection:)` + `.listStyle(.inset(alternatesRowBackgrounds: true))`
   **不变**

**Acceptance**：

1. `xcodebuild test` 全绿（含 RecordingE2E 需 pre-flight 授权，未授权 skip）
2. `grep -n "\.orange\|\.red\|\.accentColor" apps/macos/Lyre/Views/RecordingsView.swift`
   返回空
3. `Menu` context menu 保留（Show in Finder / Upload / Delete）
4. **原生性审查 pass**：
   - Cmd+A / Shift+Click / ↑↓ 键盘导航一致
   - Tab 到播放按钮时**焦点环可见**
   - `VoiceOver` 播放按钮读作 "Play / Pause" + trait `button`
   - 右键菜单弹出正常
   - Dark ↔ Light 即时切换无残留
5. **视觉验收矩阵** (dark/light × empty/loaded/playing) 6 张截图归 PR 描述

**验证步骤**：

```bash
cd apps/macos && xcodebuild test -scheme Lyre -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
swiftlint lint --strict Lyre/Views/RecordingsView.swift
grep -n "\.orange\|\.red\|\.blue\|\.green" Lyre/Views/RecordingsView.swift
# 手工：启 App → 空态截图 → 录一段 → 播放 → 多选 → 右键
```

**风险**：低。**默认走保守方案**（保留 SF Symbol 28pt，只 palette 化），
无结构变动，无 List row 高度冲击。**升级到 44pt 圆容器** 是可选路径，
需要 review 后另开一个独立小 commit（不进 C5 本身）。

---

#### C6: `feat(macos): apply Basalt palette + PhaseBadge to UploadView`

**修改文件**：`apps/macos/Lyre/Views/UploadView.swift`

**具体动作**（对齐 spec §UploadView）：

1. `TextField` / `Picker` / `SecureField` 保留原样（`palette.input 边界`
   规则）
2. `TagChip`（`:228`，当前用 `Capsule()` 胶囊形状 — **保留**，只换填色）：
   - selected → `background(palette.accent.opacity(0.15), in: Capsule())` +
     `.foregroundStyle(palette.accent)` + `Capsule().stroke(palette.accent, lineWidth: 1)`
   - unselected → `background(palette.input, in: Capsule())` +
     `.foregroundStyle(palette.muted)` + stroke `.clear`
3. `progressView`（`:137`）当前是 `if case` 链，覆盖三态
   （`.presigning` / `.uploading(progress)` / `.creating`），**不含 `.failed`**
   —— failed 走 `uploadForm` 路径下方的错误 Label（`:113` 附近）。改动：
   - `.presigning` 分支：spinner + "Preparing upload..." caption →
     `PhaseBadge(phase: .running("Preparing…"))`
   - `.uploading(progress)` 分支：`ProgressView(value: progress)` **保留**（进度
     条视觉主体），下方 caption "Uploading to server..." →
     `PhaseBadge(phase: .running("Uploading \(Int(progress*100))%"))`
   - `.creating` 分支：spinner + "Creating recording..." caption →
     `PhaseBadge(phase: .running("Registering…"))`
   - "Cancel Upload" 按钮保留
4. `.failed` 错误态（在 `uploadForm` 里的错误 label，不在 `progressView`）：
   `.orange` Label + `exclamationmark.triangle.fill` →
   `PhaseBadge(phase: .failed(errorMessage))`
5. `completedView`（`:169`）— **不用 `PhaseBadge`**（会和 40pt checkmark
   视觉重复）。走 macOS completion state 惯例：
   - `Image(systemName: "checkmark.circle.fill")` 40pt +
     `.foregroundStyle(palette.success)` （替换原 `.green`）
   - "Upload Complete" 用 `BasaltFont.cardTitle` + `palette.fg`
   - 下方 summary 保留原结构，只把 `.caption` + `.secondary` 换成
     `BasaltFont.caption` + `palette.muted`
   - `PhaseBadge(.succeeded)` **只用在** in-line 状态标签场景（如列表
     行末），不用在这种大居中完成页

**Acceptance**：

1. `xcodebuild test` 全绿
2. `grep -n "\.orange\|\.green" apps/macos/Lyre/Views/UploadView.swift` 返回空
3. `TextField` / `Picker` 保持系统默认 `.roundedBorder`
4. **原生性审查 pass**：
   - Tab 遍历 title / folder / tag chips
   - Tag chip Space 键触发 toggle
   - Cancel Upload 按钮键盘可达
   - VoiceOver 读 tag chip：`"Meeting, selected"` / `"Meeting, button"`
5. **视觉验收矩阵**：4 上传状态 (idle/uploading/completed/failed) ×
   dark/light = 8 截图

**验证步骤**：

```bash
cd apps/macos && xcodebuild test -scheme Lyre -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
swiftlint lint --strict Lyre/Views/UploadView.swift
# 手工：录一段 → 上传，四态各截图
```

**风险**：中。`PhaseBadge` 是新组件，会显示在 progressView 里，需要
`AsyncStream` 或 `@State` 让 uploading 的百分比刷新（当前已有 `progress`
binding）。

---

#### C7: `feat(macos): apply Basalt palette to SettingsView`

**修改文件**：`apps/macos/Lyre/Views/SettingsView.swift`

**具体动作**（对齐 spec §SettingsView）：

1. `Form { … }.formStyle(.grouped)` 后加
   `.scrollContentBackground(.hidden)` + `.background(palette.bg)`
2. `statusBadge`（`.foregroundStyle(.green / .red)`）→ palette 语义色：
   - success → `palette.success`
   - failed → `palette.destructive`
   - testing → `palette.muted`
3. `TextField` / `SecureField` **保留** `.roundedBorder`（系统焦点环 +
   拼写检查）
4. 眼睛切换按钮：`Image(systemName: showTokenField ? "eye.slash" : "eye")`
   `.foregroundStyle(palette.muted)` 保留系统 hover 反馈
5. `Test Connection` 按钮保留系统 style，不改
6. Section header 保留系统默认（`.grouped` 会给 uppercase small-caps）

**Acceptance**：

1. `xcodebuild test` 全绿
2. `grep -n "\.green\|\.red\|\.orange" apps/macos/Lyre/Views/SettingsView.swift` 返回空
3. `TextField` focus ring 保留（Tab 到时可见）
4. **原生性审查 pass**：
   - Tab 遍历 URL / Token / Test button
   - 眼睛按钮 Space 键切换 SecureField ↔ TextField
   - VoiceOver 读 token field：`"Auth Token, secure text field"`
5. **视觉验收矩阵**：dark/light × (untested/testing/success/failed) = 8 截图

**风险**：低。`Form(.grouped)` 底色替换是 macOS 13+ 原生支持。

---

#### C8: `feat(macos): apply Basalt palette to PermissionGuideView`

**修改文件**：`apps/macos/Lyre/Views/PermissionGuideView.swift`

**具体动作**（对齐 spec §PermissionGuideView）：

1. Header icon `.foregroundStyle(.blue)` → `palette.accent`
2. `PermissionRow`（`:92`）外层套 `basaltCard(radius: Radius.widget)`，
   内部结构不改
3. 每行状态图标色（`PermissionManager.Status` 只有 `.unknown` / `.granted`
   / `.denied` 三个值）：
   - `.granted` → `palette.success`
   - `.denied` → `palette.destructive`
   - `.unknown` → `palette.muted`
4. "All permissions granted" label 从 `.green` → `palette.success`
5. `pollTimer` 保持 —— `stopPolling()` 已在 `onDisappear`（spec §内存生命周期）

**Acceptance**：

1. `xcodebuild test` 全绿
2. `grep -n "\.blue\|\.green\|\.red" apps/macos/Lyre/Views/PermissionGuideView.swift` 返回空
3. 每行 `basaltCard` 结构：卡片背景 L2、`Radius.widget` 圆角、`basaltShadow`
4. **原生性审查 pass**：
   - Refresh Status 按钮 Tab 可达
   - VoiceOver 读每行 `"Screen Recording, granted"`
5. **视觉验收矩阵**：dark/light × (all granted / partial / all denied) = 6 截图

**风险**：低。`PermissionRow` 结构不改，只加 modifier。

---

#### C9: `feat(macos): apply Basalt font ladder to AboutView`

**修改文件**：`apps/macos/Lyre/Views/AboutView.swift`

**具体动作**（对齐 spec §AboutView）：

1. `.font(.title).fontWeight(.bold)` → `BasaltFont.pageTitle`
2. `.font(.caption)` 版本号 → `BasaltFont.caption` + `palette.muted`
3. `.font(.body)` 描述 → `BasaltFont.body` + `palette.muted`
4. `Divider().frame(width: 200)` → `Rectangle().fill(palette.border).frame(width: 200, height: 0.5)`
5. `.font(.caption2).foregroundStyle(.tertiary)` 版权 →
   `BasaltFont.caption` + `palette.mutedSubtle`
6. `Link` 保留系统 style
7. 外层 padding 从 `padding(30)` → `padding(Spacing.xl)`（24pt）

**Acceptance**：

1. `xcodebuild test` 全绿
2. `grep -n "\.tertiary\|\.orange" apps/macos/Lyre/Views/AboutView.swift`
   命中项人工审查（`.tertiary` 应该没有留存；`.secondary` **可以保留**
   在系统 `Link` 的默认样式上下文里，不硬性去除）
3. `grep -n "\.font(\.title\|\.font(\.caption\|\.font(\.body" apps/macos/Lyre/Views/AboutView.swift` 返回空
4. **原生性审查 pass**：
   - Tab 遍历 GitHub / Issue 链接
   - `Link` 系统 hover 反馈保留（下划线出现）
   - VoiceOver 读链接：`"GitHub Repository, link"`
5. **视觉验收矩阵**：dark/light × Dynamic Type (xSmall / large / accessibility3) = 6 截图

**风险**：低。纯文字属性替换。

---

#### C10: `feat(macos): apply Basalt bg to MainWindowView detail area`

**修改文件**：`apps/macos/Lyre/LyreApp.swift`

**具体动作**（对齐 spec §LyreApp）：

1. `MainWindowView.body` 里 `TabView(selection:)` 外层加
   `.background(palette.bg)`（`@Environment(\.palette) private var palette`
   在 MainWindowView 里添加）
2. `TrayMenu` **不动** —— 保持 MenuBarExtra 原生外观
3. `TrayLabel` **不动**
4. `InputDeviceMenu` **不动**
5. 追加注释说明：`elapsedTimer` 已审计，录音中直接 Quit 会泄漏但进程即将
   退出所以无影响；正常 stopRecording 路径 `stopElapsedTimer()` 已 invalidate

**Acceptance**：

1. `xcodebuild test` 全绿
2. **原生性审查 pass**：
   - Menu bar tray 图标不变（`TrayLabel` 无 palette）
   - Tray popover 里的字体/间距是系统默认 vibrancy
   - Cmd+, 打开主窗口，detail 区域底色为 `palette.bg`
3. `grep -n "palette\." apps/macos/Lyre/LyreApp.swift` 命中项人工审查：
   palette 引用应仅出现在 `MainWindowView`，不应出现在
   `MenuBarExtra` / `TrayMenu` / `TrayLabel` / `InputDeviceMenu` 里
   （menu bar 保持系统 vibrancy）
4. **视觉验收矩阵**：dark/light × (每个 tab 切换) = 8 截图

**风险**：低。改动集中在 MainWindowView.body。

---

### CHECKPOINT ✅ Stage 3 完成

- [ ] C5–C10 全 merge 后：
  - 全局 `xcodebuild test` 全绿
  - 全局 `swiftlint --strict apps/macos/Lyre/ apps/macos/LyreTests/` 0 violations
  - `bun run test` 229/229
  - pre-commit / pre-push hook 手工过一遍
- [ ] 全局 grep 验收（`docs/07` Acceptance §命名规范）：
  ```bash
  grep -rn "Color(red:" apps/macos/Lyre/ | grep -v Theme/          # empty
  grep -rn "foregroundStyle(\.orange\|\.red\|\.blue\|\.green" apps/macos/Lyre/Views/  # empty
  grep -rn "Font\.system(size:" apps/macos/Lyre/                    # empty
  ```
- [ ] 手工冒烟：录音 → 停止 → 上传 → 播放 → 删除 → 权限重开 → 设置改 →
      切 dark/light 全路径无回归
- [ ] Release notes 草稿准备：`feat(macos): Basalt visual identity`

---

## 命令备忘

**每个 commit 前的验证套装**：

```bash
# macOS build + test
cd apps/macos && xcodegen generate
xcodebuild build-for-testing -project Lyre.xcodeproj -scheme Lyre \
  -configuration Debug -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
xcodebuild test -project Lyre.xcodeproj -scheme Lyre \
  -configuration Debug -destination "platform=macOS" -quiet \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO

# lint
swiftlint lint --strict Lyre/ LyreTests/

# 全局质量门（Stage 3 每 commit 都跑一次）
cd /Users/nocoo/workspace/personal/lyre
bun run test
bun run typecheck
bun run lint
```

**Commit message 惯例**：

- 全部 `feat(macos): …` 前缀（Stage 1 也是 feat，因为对外可见地"加了个视觉体系"）
- Body 引用 `docs/07-macos-ui-basalt-upgrade.md` 章节号 + `nmem` id
- **不 `git push`**（等到全部 rollout 完成 + 手工过一遍 acceptance 再统一发版）

## 回滚策略

- 单页面 rollback：`git revert <sha>`，只影响该页面
- Token 层 rollback：`git revert C1` 会破坏 Stage 2 + Stage 3 所有 commit，
  等价"取消本次升级"。因此 Stage 1 pass 后必须 CHECKPOINT 手工确认视觉零变化，
  再继续 Stage 2

## Non-Blocking Follow-ups

以下**不进本次范围**，作为独立后续 task 记录：

- `NavigationSplitView` sidebar 底色改造（需要 `NSVisualEffectView` 桥接）
- `Form(.grouped)` section header 底色（需要 `NSTableView.appearance()`
  桥接，`docs/07` §Retrospective 已标）
- 未来"AI 生成摘要"loading 文本 shimmer 效果（`docs/07` §动态视觉效果的
  边界 已标为未来考虑）
- Menu bar tray 内的 elapsed display 从 Timer 迁移到 `TimelineView(.periodic)`
  以彻底消除泄漏可能（当前进程即将退出所以无影响）。
  **反模式警告**：不要用"给 `TrayMenu` 加 `.onDisappear { stopElapsedTimer() }`"
  作为兜底 —— `MenuBarExtra` popover 的 lifecycle 与主窗口不同，菜单
  关闭时会触发 `.onDisappear`，反而会在录音中停掉 elapsed 显示。彻底
  方案必须走 `TimelineView(.periodic)` 或明确的 lifecycle 重构
