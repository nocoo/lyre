# macOS UI Basalt Upgrade

> 按 **Basalt 规范 (B-6): macOS SwiftUI 现代视觉体系**（`nmem` id `36f15892`）给
> `apps/macos/Lyre` 做视觉体系升级。目标是**在保持 macOS 原生效率的前提下**
> 把 UI 从"SwiftUI 系统默认"升级到有可辨识 App 身份的表面语言，同时严格遵守
> Apple Human Interface Guidelines。

## Motivation

现状：`apps/macos/Lyre/Views/*.swift` + `LyreApp.swift` 全部走系统默认样式。
颜色只用 `.primary` / `.secondary` / `.accentColor`；间距全部 magic number；
零阴影、零动效、零字号阶梯。做出来的界面**功能可用但缺乏 App 身份** ——
像一个没做过设计的原型。

问题**不是**"要更多装饰"，而是"要让 macOS App 具备可辨识的**表面语言**"
—— 卡片背景色、边线、软阴影、状态色、字体 rounded、accent hue —— 那些
让用户"一眼认出这是 Lyre"的东西。**布局、导航结构、控件语义全部保留
macOS 原生**。

### 品牌 Accent

**橙色系**（Lyre 视觉主色）：

```swift
accent: Color(hex: "#F58A2A")   // light — warm orange
accent: Color(hex: "#FFA054")   // dark — softer orange for reduced contrast
```

`success` / `warning` / `destructive` 使用 B-6 默认。

### 目标 vs 非目标

**目标**：

- 建立 Token 层（Spacing / Radius / Palette / Font / Motion）作为**单一出口**
- 给自定义 surface 一致的外观：卡片背景、软阴影、`.continuous` 圆角、细边框
- 状态色（成功 / 警告 / 失败 / 录音中）从 palette 出，不再散落 `.orange`/`.red`/`.green`
- 每个页面按**自身特性**做细化 —— 一个菜单栏工具不做全站化 metric 汇总

**非目标**：

- ❌ **不把系统 `List` / `Form` / `Picker` 换成自造控件**。macOS 用户的肌肉记忆和
  Finder-style 扫描效率优先于视觉统一
- ❌ **不放大字号 / 不加顶栏 StatCard 汇总卡** —— 那是数据仪表盘语言，
  套到菜单栏工具会显得冗余
- ❌ **不动** 录音 / 上传 / 权限 / DMG / menu bar tray 五条业务链路
- ❌ **不引入** 任何第三方 UI 库
- ❌ **不改** `TabView(sidebar)` 顶层导航结构

### 关于动态视觉效果的边界

Shimmer / gradient text sweep 类装饰在 SwiftUI 里可以做得很专业
（`TimelineView(.animation)` + `Canvas` + `accessibilityReduceMotion` +
offscreen / scroll / background pause 门 + activity gate 清理 task），但
**本次不引入**。理由：

- Lyre 是菜单栏录音工具，视觉主职责是"快速扫描 + 定位录音"，装饰性动效
  会增加认知噪音
- shimmer 用在标题、列表行、常驻状态上会形成持续注意力吸引，与"低调工具"
  定位冲突

**未来**如果确实需要（例如"AI 正在生成摘要"的 loading 文本），仅作为
**局部、临时、单次**的过程反馈使用，不用于品牌装饰、常驻标题或长期状态。

## 现状 Audit（按页面）

按 Basalt B-6 反模式清单扫描 `apps/macos/Lyre/Views/*.swift` + `LyreApp.swift`。

### 通用违规

```
grep -rn "padding("  → 40+ 处 magic number
grep -rn ".shadow("  → 0（无阴影 = 无层次）
grep -rn ".animation(" → 0（无动效）
grep -rn "cornerRadius:" → 0（全靠系统控件默认圆角，未显式指定 .continuous）
grep -rn "foregroundStyle(\.orange\|\.red\|\.blue\|\.green" → 6+ 处硬编码
```

### 内存生命周期

| 位置 | 状态 |
|------|------|
| `PermissionGuideView.swift:9` 的 `pollTimer` | ✅ `onDisappear { stopPolling() }` 已存在（`:73`），无需处理 |
| `LyreApp.swift:119` 的 `elapsedTimer` | ⚠️ Stage 1 顺手审计一次 |
| `RecordingsView.swift:29-36` 的 `store.stopWatching()` + `player.stop()` | ✅ 已 OK |

## Token 与文件规划

```
apps/macos/Lyre/
├── Theme/
│   ├── Spacing.swift          # enum Spacing
│   ├── Radius.swift           # enum Radius (widget / card / island / pill)
│   ├── Color+Hex.swift        # Color(hex:) init
│   ├── Palette.swift          # struct Palette + .resolved(scheme)
│   ├── PaletteEnvironment.swift  # @Environment(\.palette)
│   ├── BasaltFont.swift       # 语义 Font roles（relativeTo Dynamic Type）
│   ├── BasaltMotion.swift     # enum Motion (quick / regular / smooth / stagger)
│   └── Surfaces.swift         # View extensions: basaltCard / basaltField / basaltShadow
└── Components/
    ├── EmptyStateCard.swift   # 空态一致外观
    ├── PhaseBadge.swift       # running/succeeded/failed 状态标签
    └── ... (按消费场景**懒引入**，见 §逐页面章节)
```

不预先建"5 个通用组件"—— 组件按**每个页面实际需要**再落。避免过早抽象。

## 逐页面章节

每个页面单独一节：**当前问题 → 目标视觉 → 具体动作**。所有页面共用 §Token
层，页面之间不复制组件。

### palette.input 边界（贯穿全页面）

`palette.input` 只用于**自造**的可交互元素 —— chip、icon button、自造 badge
底、自造 segmented 底。**系统控件不套 `basaltField`**：`TextField` /
`SecureField` / `Picker` / 系统 `Button` 的焦点环、圆角、hover 反馈都来自
AppKit 层，覆盖它们会破坏 macOS 键盘导航和 VoiceOver 语义。

判定：如果一个元素**已经是 SwiftUI 系统控件**，只改文字色 / label 色（用
palette），底色和圆角保持默认。只有**手写的 View**才用 `basaltField`。

### RecordingsView

**当前**（`apps/macos/Lyre/Views/RecordingsView.swift`）：

- `List(selection:)` + `.listStyle(.inset(alternatesRowBackgrounds: true))` — 系统外观
- `RecordingRow`：`play.circle.fill` 28pt + `.orange` 播放色硬编码、`.accentColor` 待机
- 空态：`waveform.circle` 48pt + `.secondary` 文字，纯默认
- toolbar 里 batch delete button `.foregroundStyle(.red)`

**目标**：保留 `List(selection:)` 外壳（多选、键盘导航、Finder 式扫描效率一律
不动），只重构 **row 内部**的密度、颜色、hover / selection 视觉。

**动作**：

1. 空态换 `EmptyStateCard`（外层容器，SF Symbol + 标题 + 副标题，
   `basaltCard` 底），文案不变。
2. `RecordingRow` 视觉改造（**结构不改**，仍是 `HStack`）：
   - 播放按钮圆背景 `palette.input` + `palette.accent` icon，播放中态改
     `palette.accent` fill；不再 `.orange`
   - 时间 / 大小 / 日期用 `BasaltFont.caption` + `palette.muted`
   - 当前播放时长换 `BasaltFont.mono.monospacedDigit()`
   - selection 高亮由 `List` 默认给（保留 macOS 语义），**不覆盖**
3. `List` 底色：`.scrollContentBackground(.hidden)` + `palette.bg`（macOS 13+）
4. 批量删除按钮保留 `role: .destructive`，**不硬写 `.red`**（系统会根据 role
   给正确的语义色，dark/light + 高对比度模式都自动处理）
5. **不加**顶部 StatCard 汇总（"总录音数 / 总时长" 对本地工具不是高频决策
   信息，会吃掉默认窗口首屏）

**验收**：Cmd+A 全选、Shift+Click 范围选、↑/↓ 键盘导航、右键菜单、`Reveal in
Finder` 全部与升级前**行为一致**。

### SettingsView

**当前**（`apps/macos/Lyre/Views/SettingsView.swift`）：

- `Form { Section }` + `.formStyle(.grouped)` — macOS 用户预期
- Status badge：`.foregroundStyle(.green / .red)` 硬编码
- Token 输入：`.roundedBorder` + 右侧眼睛切换按钮
- "Test Connection" 用系统按钮

**目标**：保留 `Form(.grouped)` 骨架（macOS 用户熟悉的设置页样式），只统一
底色与状态色。

**动作**：

1. `Form` 加 `.scrollContentBackground(.hidden)` + `.background(palette.bg)`
2. Status badge 状态色从 palette 取：`palette.success` / `palette.destructive` /
   `palette.muted`（测试中态）；**不再** `.green` / `.red`
3. `TextField` / `SecureField` 保留 `.roundedBorder`（系统 field 有自带的
   focus ring / 拼写检查行为，自造 field 得不偿失）
4. 按钮全部保留系统按钮，不换。`Test Connection` 用默认 style
5. Section header 字体保留系统（`Form(.grouped)` 会应用 macOS 原生的
   uppercase small-caps）

### UploadView

**当前**（`apps/macos/Lyre/Views/UploadView.swift`）：

- 表单区 `.roundedBorder` textfield + system `Picker` + 自造 `TagChip` + `FlowLayout`
- 上传态：4 段 switch (idle/presigning/uploading/creating/completed/failed)
  但**只显示一段进度条**，没有 phase 文字
- 错误：`.orange` label + text

**目标**：把上传过程"看得见"（阶段文字），错误明确，其他保持不动。

**动作**：

1. `TextField` / `Picker` / `SecureField` 全部保留原样
2. `TagChip` 用 palette 重刷：selected → `palette.accent.opacity(0.15)` bg +
   `palette.accent` fg；unselected → `palette.input` + `palette.muted`
3. 上传态引入 `PhaseBadge`：presigning → "Preparing…" / uploading → "Uploading
   {%}…" / creating → "Registering…"；每阶段都可见
4. 错误从 `.orange` Label 改为 `palette.destructive` 文字 +
   `Image(systemName: "exclamationmark.triangle.fill")`，与 §PermissionGuideView
   的失败态用同一套视觉语言
5. 成功态：`palette.success` + `checkmark.circle.fill`，文案不变

### PermissionGuideView

**当前**（`apps/macos/Lyre/Views/PermissionGuideView.swift`）：

- Header `shield.checkered` 40pt `.blue`
- 每个权限 `PermissionRow`（自造）—— 视觉一致性还行
- "All permissions granted" label `.green`

**目标**：把硬编码色换 palette，`PermissionRow` 卡片化提升层次感。

**动作**：

1. Header icon 色从 `.blue` 换 `palette.accent`
2. `PermissionRow` 外层套 `basaltCard`（radius 10 widget 级别），内部结构不改
3. 权限状态色：granted → `palette.success` / denied → `palette.destructive` /
   notDetermined → `palette.muted`
4. "All permissions granted" 那行的 `.green` 换 `palette.success`
5. `pollTimer` 已有 `stopPolling()`，无需变动

### AboutView

**当前**（`apps/macos/Lyre/Views/AboutView.swift`）：

- 结构简洁：icon + name + version + description + divider + links + copyright
- 字体全系统 token（`.title / .caption / .caption2`）

**目标**：字号阶梯用 `BasaltFont`（`relativeTo` 保留 Dynamic Type 缩放），
链接维持原生 `Link`（`CopyableField` 不适用 GitHub URL 场景）。

**动作**：

1. 字号换 `BasaltFont.pageTitle` / `BasaltFont.body` / `BasaltFont.caption`
2. Divider 换 `palette.border` 0.5px `Rectangle`（视觉更细）
3. 版权行用 `palette.mutedSubtle`
4. `Link` 保留系统样式（原生按钮 hover / focus 行为最优）

### LyreApp（Root + TrayMenu）

**当前**（`apps/macos/Lyre/LyreApp.swift`）：

- `TabView(sidebar)` — 保留
- Tray menu 全系统外观
- `elapsedTimer` @ `:119` — 需审计

**目标**：Root 注入 palette，Tray 保留 macOS 原生 menu bar 交互。

**动作**：

1. Root scene 注入 `.environment(\.palette, .resolved(scheme))`
2. `TabView` detail 区域 `.background(palette.bg)`
3. Tray menu 保留系统外观（menu bar 的语义色是系统级别，改了破坏一致性）
4. `elapsedTimer` 生命周期审计：确认 `.onDisappear` 有 invalidate，如有
   泄漏则修补（不属于视觉升级，属顺手清理）

## 3 阶段落地路径

### Stage 1 — Token 骨架（估 1 天，零视觉变化）

范围：只加基础设施 + `LyreApp.swift` 根节点注入 palette。**不改任何业务页面**
（`Views/*.swift` 保持不变）。

- [ ] `Theme/Spacing.swift` `Radius.swift` `Color+Hex.swift` `Palette.swift`
      `PaletteEnvironment.swift` `BasaltMotion.swift` `Surfaces.swift`
- [ ] `Theme/BasaltFont.swift` — **从 Stage 1 开始就用 `.system(_:size:relativeTo:)`
      和 semantic role**（不是固定字号）：

    ```swift
    public enum BasaltFont {
        // 标题走 rounded；正文/微标签走 default，全部 relativeTo semantic role
        public static let pageTitle    = Font.system(.title,     design: .rounded).weight(.semibold)
        public static let cardTitle    = Font.system(.headline,  design: .rounded).weight(.semibold)
        public static let body         = Font.system(.body)
        public static let caption      = Font.system(.caption)
        public static let sectionLabel = Font.system(.caption).weight(.semibold)  // uppercase + tracking 由 View 层加
        public static let mono         = Font.system(.body, design: .monospaced)
        public static let stat         = Font.system(.title, design: .rounded).weight(.semibold).monospacedDigit()
    }
    ```

    这样 Dynamic Type 缩放天然生效；如果哪一处必须用固定字号（例如极小的
    utility label），必须在注释里说明**为什么不能用 semantic role**。
- [ ] `LyreApp.swift` root 注入 `.environment(\.palette, .resolved(scheme))`
- [ ] `LyreTests/BasaltTokenTests.swift`：
    - palette L0 < L1 < L2 亮度关系断言（防退化）
    - **Dynamic Type 渲染冒烟**：一个 `DemoView` 里堆叠 6 个 role
      (`pageTitle` / `cardTitle` / `body` / `caption` / `sectionLabel` /
      `stat`) 各一行文字 + 一段 3-line 的段落，在 `.dynamicTypeSize(.xSmall)`
      / `.large` / `.accessibility3` 三档下：
        - **编译级 smoke**：test 里实例化 view + 求值 `body` 一次，不
          crash 即通过（这是"零依赖"路线；SwiftUI 视图对象是值类型，
          获取 `body` 触发一遍 `ViewBuilder` 树的构造）
        - **静态 grep 守卫**：`grep -rn "Font\.system(size:" Theme/`
          必须返回空（禁止固定字号）；`grep -rn "\.frame(height:"
          apps/macos/Lyre/` 命中的每一处，人工审查是否会锁死 Dynamic
          Type 缩放（预计只在 icon 容器等固定尺寸场景合理出现）
        - **视觉验收**：三档 Dynamic Type × dark/light 6 张截图归档到
          PR 描述，人工确认主信息不被截断
    - **不引入** `ViewInspector` / snapshot testing 依赖（本项目零第三方
      UI 依赖策略）

**验收**：
- macOS xcodebuild test 全绿（新增 1 个 suite）
- 视觉零变化（没 view 消费 palette）
- swiftlint 0 violations

### Stage 2 — Surfaces + Components 基础套件（估 1–2 天）

范围：加**这次真正会用到**的组件。不加投机性组件。

- [ ] `Theme/Surfaces.swift` 三个 modifier：`basaltCard()` / `basaltField()` /
      `basaltShadow()`
- [ ] `Components/EmptyStateCard.swift`（RecordingsView 空态用）
- [ ] `Components/PhaseBadge.swift`（UploadView 上传阶段用）
- [ ] `LyreTests` 新增：三个 modifier 挂到 dummy view 上**编译通过 +
      body 求值不 crash**（无 snapshot 库依赖）；dark/light 两张截图归档
      到 PR 描述作为视觉基线

**不加**：BasaltSegmented / BasaltSlider / CopyableField / StatCard。真的需要
再加。

**验收**：所有新增文件独立可编译；仍无 view 消费；swiftlint 0 violations。

### Stage 3 — 逐页面 rollout（估 2–3 天）

按用户使用频率排序：

- [ ] **RecordingsView**（最先做，验证方向；出 dark/light 两张截图给哥）
- [ ] **UploadView**（依赖 PhaseBadge）
- [ ] **SettingsView**（Form 底色 + status 色）
- [ ] **PermissionGuideView**（每个 row 卡片化）
- [ ] **AboutView**（字号阶梯）
- [ ] **LyreApp**（root 底色 + elapsedTimer 生命周期审计）

每个页面独立 commit，方便回滚。每个 commit 附一张 dark 一张 light 截图（贴到
PR 描述里）。

**验收**：见下 §视觉验收矩阵。

## Acceptance Criteria

原则：**自定义 surface / 状态色不出现未命名 literal**；**系统控件保留原生
语义**；**palette 只接管品牌 surface 和状态 badge**。不做机械的 grep 100%。

### 命名规范（强制）

1. 自定义 palette / surface / shadow / motion 全部经过 Token 层，`grep -rn
   "Color(red:"` 在 non-Theme 目录返回 0
2. 状态色（success/warning/destructive/accent）经过 palette，`grep -rn
   "\.foregroundStyle(\.orange\|\.red\|\.blue\|\.green" | grep -v Theme/`
   返回 0
3. 所有**新**自定义 `RoundedRectangle` 用 `.continuous` + `Radius.*` 常量。
   系统控件 (`.roundedBorder`, `Button`, `Picker`) 的默认圆角**不动**
4. 所有**新**动画显式带 `value:` 且 `@Environment(\.accessibilityReduceMotion)`
   守卫。已有零动画代码不追溯

### 系统语义（强制保留）

5. `role: .destructive` 按钮：**不覆盖颜色**（系统会给正确的语义色）
6. `TextField` / `SecureField` / `Picker` / `Form.Section`：保留系统默认外观
7. `List(selection:)` 的多选 / 键盘导航 / hover：不覆盖
8. Menu bar tray 与 `MenuBarExtra` 内的所有 UI：不动

### 原生性审查（每个页面 rollout 前逐条过）

每个新增或改造的视觉元素，进 PR 前必须逐条通过：

- **键盘导航**：Tab / Shift-Tab 遍历所有可交互元素；`Space` / `Return` 触发；
  `↑↓` 在列表内移动；`Cmd+A` 全选（如适用）
- **焦点环**：所有可获焦元素在 Tab 到时**可见**焦点环（系统 focus ring
  未被自定义 background 遮挡）
- **VoiceOver**：Cmd+F5 打开，`VO+右方向` 遍历，每个元素读出**有意义
  的 label** + **正确的 trait**（button / heading / selected / disabled）
- **系统 destructive 语义**：删除类按钮的红色由 `role: .destructive`
  提供，不硬编码
- **Menu bar 原生外观**：`MenuBarExtra` 与其 popover 保持系统 vibrancy /
  字体 / 间距，不套 palette
- **Right-click / context menu**：如原本存在，仍然工作
- **Dark ↔ Light 即时切换**：System Settings → Appearance 切换时，界面
  立刻响应，不残留旧色

这套审查比 grep 更能保证最终像一个专业 macOS App。

### Dynamic Type & Accessibility

9. 所有文字用 `BasaltFont` 语义 role（`relativeTo`），不用固定 `size:`
   （除非有注释说明必须固定）
10. 所有动画 `withAnimation` / `.animation` 检查 `accessibilityReduceMotion`
11. VoiceOver：所有自造按钮 / badge 提供 `accessibilityLabel`（是什么） +
    `accessibilityValue`（当前状态） + `accessibilityHint`（可选，动作提示）。
    优先靠这三个静态描述**表达状态**，不主动播报。
    只有**非频繁的关键状态迁移**（例如"上传完成" / "上传失败" / "录音
    已开始"）才用 AppKit 的 `NSAccessibility.post(element:notification:)`
    主动播报；禁止在高频事件（如进度条 tick、hover）上播报，避免
    VoiceOver 噪音。

### 生命周期（顺手清）

12. Timer 类 `@State` 变量：`onDisappear` 显式 invalidate（`pollTimer` 已 OK；
    `elapsedTimer` Stage 3 审计）
13. Task 类：优先 `.task(id:)`，手写 Task 得有 cancel

### 测试

14. `bun run test` 229/229 全绿
15. `xcodebuild test` 全绿
16. `swiftlint lint apps/macos/Lyre` 0 violations
17. pre-commit / pre-push hook 全过

### 视觉验收矩阵

每个改过的页面提交前，人工过一遍这个矩阵（截图归到 PR 描述）：

|                | Light | Dark |
|----------------|:-----:|:----:|
| Empty state    |  ▢    |  ▢   |
| Loaded / data  |  ▢    |  ▢   |
| Loading        |  ▢    |  ▢   |
| Error          |  ▢    |  ▢   |
| 默认窗口 (~600×500) | ▢ |  ▢   |
| 窄窗口 (~400 宽)    | ▢ |  ▢   |
| Reduce Motion on    | ▢ |  ▢   |
| Dynamic Type XL     | ▢ |  ▢   |

其中 UploadView 需要额外过一遍 4 个上传阶段（idle / uploading / completed /
failed），RecordingsView 需要过一遍多选 + 播放中状态。

## Retrospective 预留

**已知会遇到的坑**（macOS 原生 UI 层，AppKit 而非 UIKit）：

- **`NavigationSplitView` sidebar 的 vibrancy 底色** — macOS 15 sidebar 走
  `NSVisualEffectView` 磨砂层，`.background(palette.bg)` 只作用于 detail 区。
  可以接受（sidebar 使用系统 vibrancy 与其他 macOS App 一致，更协调）
- **`Form(.grouped)` 的 section header 底色** — macOS 系统会强制加透明层。
  `.scrollContentBackground(.hidden)` 只处理 body 底色。如果 header 底色需要
  改，可以用 `NSAppearance` 桥接或 `NSTableView.appearance()`（AppKit，非
  UIKit）；本次**不改**，保留系统默认
- **`Picker` 的 focus ring** — focus ring 来自 AppKit，`.tint()` 只影响部分
  控件。UploadView 的 folder Picker 我们**不动**，focus ring 保持系统色
- **`List(.inset(alternatesRowBackgrounds:))` 的间隔条** — 底色不受 palette
  控制，是 NSTableView 层。接受这个 fallback；如果视觉太违和，改成不 alternate

## 参考

- Basalt 规范 (B-6)：`nmem memories show 36f15892-6bc4-47c0-af78-4099f1f480d1`
- Basalt B-5 色彩亮度系统：`nmem memories show e6e30322-7279-4f8e-8e4b-c8be963789e3`
- Basalt B-4 内容页面 UI：`nmem memories show 7f8cbd83-4afc-42ee-9fe6-80598951b2d6`
