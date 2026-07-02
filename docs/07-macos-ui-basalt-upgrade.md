# macOS UI Basalt Upgrade

> 按 **Basalt 规范 (B-6): macOS SwiftUI 落地**（`nmem` id `36f15892`）给
> `apps/macos/Lyre` 做视觉体系升级。目标是在**不改变导航结构**、**不引入新依赖**、
> **不影响录音/上传核心路径**的前提下，把 UI 从"系统默认克制"升级到"Basalt 家族
> 视觉身份"，与网页端（`apps/web`）保持一致的品牌感。

## Motivation

### 症状

`apps/macos/Lyre/Views/` 5 个页面 + `LyreApp.swift` 全部采用 SwiftUI **系统默认策略**：

- 颜色只用 `.primary` / `.secondary` / `.accentColor` / `.orange` / `.blue` / `.red`
- 间距全靠 magic number：`padding(24)`、`spacing: 12`、`padding(30)`
- 阴影：**零**
- 圆角：默认（未指定 `.continuous`）
- 卡片/面板：`Form { Section }` + `.formStyle(.grouped)` 系统组框
- 排版：`.title` / `.headline` / `.caption` dynamic type token，无精调字号
- 动效：无

对照 Basalt Web 端（`apps/web` 的 dashboard/recordings/settings 三大页面）已经建立的
14px card radius、精细 palette、fade-up 动画、多层字号 —— macOS App **明显被落下一代**。
用户第一印象是"Web 是一个精心设计的产品，macOS 是配套的小工具"。

### 目标

对齐 **Basalt 规范 (B-6)** 的十一章内容：

1. Token 系统（Spacing / Radius / Palette）单一出口
2. Surface 三种 modifier（`basaltCard` / `basaltField` / `basaltShadow`）
3. 字体系统（对齐 Web `text-*` 阶梯）
4. 五个核心组件（Segmented / Slider / CopyableField / StatCard / EmptyStateCard）
5. macOS 原生导航壳保留（`NavigationSplitView` + `Form(.grouped)` + `.scrollContentBackground(.hidden)`）
6. 动效规范（时长常量 + `accessibilityReduceMotion` + Symbol replace）
7. 内存生命周期审计（Timer / Task / Observer / AV）

### 非目标

- ❌ **不重构** `TabView` sidebar 结构（保留 `Tab("Recordings"/"Permissions"/"Settings"/"About")`）
- ❌ **不动** 录音 / 上传 / 权限管理三条业务链路
- ❌ **不引入** 第三方 UI 库（`GradientShimmer` 等留给未来考虑，不在本次范围）
- ❌ **不改** menu bar tray 结构与快捷键
- ❌ **不改** DMG 打包流程

## 现状 Audit

按 B-6 反模式扫描（见 B-6 第十章）覆盖 `apps/macos/Lyre/Views/*.swift` + `LyreApp.swift`。

### 每个页面的具体问题

| 页面 | 行数 | 问题清单 |
|------|-----:|---------|
| `LyreApp.swift` | 309 | `TabView` 详细页外壳无 palette 注入；tray menu 无字号规范 |
| `RecordingsView.swift` | 267 | `List(.inset(alternatesRowBackgrounds:))` 系统外观；`RecordingRow` 无 card 化；播放按钮 `.orange` / `.accentColor` 直接硬编码；空态 `waveform.circle` 48pt secondary，无 basaltCard |
| `SettingsView.swift` | 139 | `Form(.grouped)` 无 `.scrollContentBackground(.hidden)`；status badge 用 `.foregroundStyle(.green/.red)` 硬编码；`.roundedBorder` 无自定义 field |
| `UploadView.swift` | 304 | 唯一使用 `.roundedBorder` + system Picker 的页面；progress state 无 phase label；error 直接文字 |
| `PermissionGuideView.swift` | 151 | `Image(systemName:).foregroundStyle(.blue)` 硬编码色；`PermissionRow` 手撸小组件缺乏一致性 |
| `AboutView.swift` | 62 | 结构简洁但 `.font(.title/.caption/.caption2)` 全靠系统 token，无字号阶梯 |

### 命中的 B-6 反模式

```
grep -rn "Color(red:" apps/macos/Lyre → 0（好，未硬写 sRGB 色）
grep -rn "cornerRadius:" apps/macos/Lyre → 0（现有 UI 未显式指定圆角，全是控件默认）
grep -rn "padding(" apps/macos/Lyre    → 40+ 处 magic number
grep -rn "\.shadow(" apps/macos/Lyre   → 0（无阴影 = 无层次）
grep -rn "foregroundStyle(\." apps/macos/Lyre | grep -Ev "primary|secondary|tertiary"
  → .orange / .red / .blue / .green 至少 6 处硬编码
grep -rn "font(\.system(" apps/macos/Lyre → 5 处 (permission icon 40pt / recording icon 48pt 等)
grep -rn "\.animation(" apps/macos/Lyre  → 0（无动效）
```

### 内存生命周期检查（B-6 第八章）

预扫已发现的 hold：

| 位置 | 类型 | 现状 | 需要 |
|------|------|------|------|
| `PermissionGuideView.swift:9` | `@State private var pollTimer: Timer?` | ⚠️ 需确认 `onDisappear` 有 `invalidate()` | 审计 |
| `LyreApp.swift:119` | `@State private var elapsedTimer: Timer?` | ⚠️ 同上 | 审计 |
| `RecordingsView.swift:29` | `.task(id:)` on store | ✅ 自动 cancel | OK |
| `RecordingsView.swift:33` | `onDisappear { store.stopWatching(); player.stop() }` | ✅ | OK |

Timer 类是升级过程中**顺手也要审一遍**的项 —— 之前 CLAUDE.md 明确要求"注意内存泄漏"。

## Token 与文件规划

新建目录 `apps/macos/Lyre/Theme/`：

```
Theme/
├── Spacing.swift          # enum Spacing (xxs xs sm md lg xl xxl section)
├── Radius.swift           # enum Radius (widget card island pill)
├── Palette.swift          # struct Palette + Palette.resolved(scheme)
├── PaletteEnvironment.swift  # EnvironmentKey + Environment(\.palette)
├── Color+Hex.swift        # Color(hex: "#XXXXXX")
├── BasaltFont.swift       # enum BasaltFont + SectionHeader view
├── BasaltMotion.swift     # enum Motion (quick regular smooth stagger)
└── Surfaces.swift         # View extensions: basaltCard / basaltField / basaltShadow
```

新建目录 `apps/macos/Lyre/Components/`（B-6 第五章）：

```
Components/
├── BasaltSegmented.swift  # 泛型 SegmentedControl<T: Hashable>
├── BasaltSlider.swift     # 带 tabular readout
├── CopyableField.swift    # 单击复制 + symbol replace
├── StatCard.swift         # 大数字卡片（用于 Recordings 顶部汇总）
├── EmptyStateCard.swift   # 空态标准
└── PhaseBadge.swift       # running / succeeded / failed 状态标签（借鉴前端 AiSummaryCard）
```

`xcodegen` 会自动扫描新目录，无需手改 `project.yml`（当前 `sources: [Lyre]` 已经是全递归）。

### Palette 品牌色决策

B-6 palette 里 `accent` 是**项目唯一强色**（承担按钮、focus ring、录音状态指示）。
建议：

```swift
// Lyre 品牌 accent（延续现有 tray 图标绿色系）
accent: Color(hex: "#3B9E62")  // light
accent: Color(hex: "#6EE7A8")  // dark（B-6 里 success 用的色，正好复用）
```

`success` / `warning` / `destructive` 用 B-6 默认值。品牌色是**唯一需要哥拍板的决策**，
其他 palette 全 copy B-6 默认。

## 落地路径（3 阶段）

对齐 B-6 第十章。每阶段一个原子提交，阶段之间 review + 视觉截图确认。

### 阶段 1 — Token 骨架（估 1 天）

**范围**：只加基础设施，不改任何 view。

- [ ] 新增 `Theme/Spacing.swift`
- [ ] 新增 `Theme/Radius.swift`
- [ ] 新增 `Theme/Color+Hex.swift`
- [ ] 新增 `Theme/Palette.swift`（含品牌 accent 决策）
- [ ] 新增 `Theme/PaletteEnvironment.swift`
- [ ] 新增 `Theme/BasaltFont.swift`（含 `SectionHeader`）
- [ ] 新增 `Theme/BasaltMotion.swift`
- [ ] 新增 `Theme/Surfaces.swift`（`basaltCard/basaltField/basaltShadow` 三 modifier）
- [ ] `LyreApp.swift` 根节点注入 `.environment(\.palette, .resolved(scheme))`
- [ ] `LyreTests/BasaltTokenTests.swift`：palette L0<L1<L2<L3 亮度关系断言（防退化）

**验收**：
- macOS xcodebuild test 全绿（新增 1 个 test suite）
- 视觉零变化（因为没 view 消费 palette）
- swiftlint 0 violations

**风险**：无，纯新增。

### 阶段 2 — 样板页重构（估 2–3 天）

选**最主要的一个页面**做样板：**RecordingsView**（用户使用频率最高，最能验证方向）。

- [ ] 新增 6 个组件（`BasaltSegmented` / `BasaltSlider` / `CopyableField` /
      `StatCard` / `EmptyStateCard` / `PhaseBadge`）
- [ ] `RecordingsView` 重构：
    - 空态换 `EmptyStateCard`
    - `RecordingRow` 从 `List` row 改为 `basaltCard` 卡片，垂直堆叠或 grid
    - 播放按钮换成 palette.accent 主色
    - 顶部加 `StatCard` 汇总（总录音数 / 总时长 / 已上传数）
- [ ] `LyreApp.swift` detail 区域 `.background(palette.bg)`
- [ ] `LyreTests` 新增快照/结构断言（不做像素比对，只测组件挂载）

**验收**：
- `RecordingsView` 与其他 3 个未升级页面视觉对比明显（不违和 = 目标）
- 空态、有数据、多选批量删除、上传全流程手工验证一次
- 全部 Timer / Task 生命周期审计
- swiftlint / xcodebuild test 全绿

**风险**：
- `List(selection:)` 系统多选逻辑 → 换成自造 grid 需要重实现 selection binding。**如果**
  发现 selection 太复杂，回退到"保留 List 外壳，只重构 row 视觉"。
- 空态图标 `waveform.circle` 48pt → 换成 `EmptyStateCard` 后可能显得空。可加副标题
  说明"点菜单栏图标开始录音"。

### 阶段 3 — 全页面 rollout（估 2 天）

按用户使用频率排序，逐页面替换：

- [ ] `SettingsView`：`Form(.grouped)` + `.scrollContentBackground(.hidden)` + palette.bg 底；
      status badge 换 palette 色；输入框换 `basaltField`；测试连接按钮 palette.accent
- [ ] `UploadView`：`.roundedBorder` → `basaltField`；进度状态用 `PhaseBadge`；
      folder Picker 换 `BasaltSegmented`（如果选项 ≤ 4 个）或保持 Picker 但配 palette
- [ ] `PermissionGuideView`：header icon 从 `.blue` 换 palette.accent；`PermissionRow`
      重构为 `basaltCard`；`pollTimer` 生命周期确认
- [ ] `AboutView`：字号阶梯用 `BasaltFont`；GitHub / Issue 链接换 `CopyableField` 变体
      或保持 `Link`；居中卡片背景用 `basaltCard`
- [ ] `LyreApp.swift` TrayMenu：录音状态文字用 `BasaltFont.body`；elapsed 用 `BasaltFont.mono`

**验收**：
- 4 个页面视觉一致
- Dark / Light 切换即时无残留
- Reduce Motion 全局有效（关掉动画）
- swiftlint / xcodebuild test 全绿
- 手工冒烟：录音 → 停止 → 上传 → 播放 → 删除 全链路

**风险**：
- 打字号 downgrade（`.headline` → `BasaltFont.cardTitle`）可能让 dynamic type 用户不适。
  保留 `.dynamicTypeSize(.small ... .accessibility1)` 允许缩放。

## Acceptance Criteria

阶段 3 结束后，以下全部为真：

1. **零硬编码色**：`grep -rn "Color(red:\|foregroundStyle(\.orange\|\.red\|\.blue\|\.green"` 全部替换为 palette
2. **零 magic number spacing**：`grep -rn "padding(" | grep -Ev "Spacing\.|padding()"` 只剩 `.padding()` 无参形式
3. **所有圆角 `.continuous`**：`grep -rn "cornerRadius"` 全部 `RoundedRectangle(cornerRadius: Radius.xxx, style: .continuous)`
4. **所有动画显式 `value:`**：`grep -rn "\.animation("` 每处都有 `value:` 参数
5. **所有动画尊重 `accessibilityReduceMotion`**：新组件全部 `@Environment(\.accessibilityReduceMotion)`
6. **Timer / Task 无泄漏**：`pollTimer` / `elapsedTimer` 显式 `invalidate()` on disappear
7. **测试 all green**：`bun run test` 229/229 + macOS xcodebuild test 153+ 全绿
8. **swiftlint 0 violations**
9. **pre-commit / pre-push hook 全过**
10. **手工冒烟**：录音 → 停止 → 上传 → 播放 → 删除 → 权限重开 → 设置改 → 切 dark/light 全路径无回归

## Retrospective 预留

预计会撞的坑，先记下来，实际遇到时对应到 retrospective：

- **`NavigationSplitView` sidebar 无法直接注入 palette bg** → macOS 15 sidebar 走 vibrancy。
  可能需要 `.toolbarBackground(palette.bg, for: .windowToolbar)`。
- **`Form(.grouped)` 的 Section header 颜色** → 系统会强制加透明层。
  `.scrollContentBackground(.hidden)` 只处理 body 底色，header 需要 `UITableView.appearance()`
  或 `NSTableView.appearance()` 桥接（macOS 15 有原生 API 但 API 面窄）。
- **`Picker` 在自定义 palette 下的 focus ring** → focus ring 是 AppKit 层，
  `.tint()` 只影响部分控件。需要试 `NSAppearance` 桥接。
- **`List(.inset(alternatesRowBackgrounds:))` 的 alternates 底色不受 palette 控制** →
  改用自造 grid 或接受这个 fallback。

## 参考

- Basalt 规范 (B-6)：`nmem memories show 36f15892-6bc4-47c0-af78-4099f1f480d1`
- Basalt B-5 色彩亮度系统：`nmem memories show e6e30322-7279-4f8e-8e4b-c8be963789e3`
- Basalt B-4 内容页面 UI：`nmem memories show 7f8cbd83-4afc-42ee-9fe6-80598951b2d6`
