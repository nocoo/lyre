# macOS UI Basalt Upgrade — Task Checklist

对应 `tasks/plan.md` 的原子提交清单。每个任务勾选即代表**已提交并通过 acceptance**。

## Stage 1 — Token 骨架

- [ ] **C1** `feat(macos): add Basalt token layer + LyreApp palette injection`
  - [ ] `Theme/Spacing.swift` `Radius.swift` `Color+Hex.swift` `Palette.swift`
        `PaletteEnvironment.swift` `BasaltFont.swift` `BasaltMotion.swift` 新增
  - [ ] `LyreApp.swift` root 注入 `.environment(\.palette, .resolved(scheme))`
  - [ ] `BasaltTokenTests.swift`：L0<L1<L2 亮度 + Dynamic Type 三档渲染
  - [ ] `xcodebuild test` 全绿
  - [ ] `swiftlint --strict` 0 violations
  - [ ] `grep "Font\.system(size:" Theme/` 返回空
  - [ ] 手工启 App 确认视觉零变化

### ✅ CHECKPOINT Stage 1

- [ ] 视觉零变化确认
- [ ] `xcodegen generate` 已把 Theme/ 扫入 project
- [ ] `elapsedTimer` 审计结论记录（可接受泄漏）

---

## Stage 2 — Surfaces + Components

- [ ] **C2** `feat(macos): add basaltCard / basaltField / basaltShadow surface modifiers`
  - [ ] `Theme/Surfaces.swift` 三个 modifier
  - [ ] `BasaltSurfacesTests.swift`
  - [ ] `xcodebuild test` 全绿

- [ ] **C3** `feat(macos): add EmptyStateCard component`
  - [ ] `Components/EmptyStateCard.swift`
  - [ ] `EmptyStateCardTests.swift`
  - [ ] `accessibilityLabel` + `accessibilityValue` 设置
  - [ ] `xcodebuild test` 全绿

- [ ] **C4** `feat(macos): add PhaseBadge component`
  - [ ] `Components/PhaseBadge.swift` — 4 phase enum
  - [ ] `PhaseBadgeTests.swift`
  - [ ] 颜色映射到 palette.success/destructive/accent/muted
  - [ ] 不主动 VoiceOver 播报
  - [ ] `xcodebuild test` 全绿

### ✅ CHECKPOINT Stage 2

- [ ] `xcodebuild test` 全绿
- [ ] 视觉零变化确认（无 view 消费）
- [ ] `grep "\.frame(height:" Components/` 人工审查

---

## Stage 3 — 逐页面 Rollout

- [ ] **C5** `feat(macos): apply Basalt palette to RecordingsView`
  - [ ] 空态换 `EmptyStateCard`
  - [ ] `RecordingRow` 播放按钮 palette 化（保守方案：保留 28pt SF Symbol
        只改颜色到 `palette.accent`；44pt 圆容器 = 后续可选升级）
  - [ ] 时间/大小/日期字体 palette 化
  - [ ] `List` 底色 `.scrollContentBackground(.hidden)` + `palette.bg`
  - [ ] batch delete 移除 `.red`，用 `role: .destructive`
  - [ ] `grep "\.orange\|\.red\|\.accentColor" RecordingsView.swift` 空
  - [ ] 原生性审查：Cmd+A / 键盘 / 焦点环 / 右键 / dark-light 切换
  - [ ] 视觉验收矩阵 6 截图归 PR

- [ ] **C6** `feat(macos): apply Basalt palette + PhaseBadge to UploadView`
  - [ ] `TagChip` palette 化（selected/unselected）
  - [ ] `progressView` 三态（presigning / uploading / creating）用 `PhaseBadge`
  - [ ] `.failed` 用 `PhaseBadge(.failed(...))`
  - [ ] `completedView` 用 `PhaseBadge(.succeeded)` + palette.success 图标
  - [ ] `grep "\.orange\|\.green" UploadView.swift` 空
  - [ ] 原生性审查：Tab 遍历 / Space 触发 chip / VoiceOver
  - [ ] 视觉验收矩阵 8 截图（4 上传态 × dark/light）

- [ ] **C7** `feat(macos): apply Basalt palette to SettingsView`
  - [ ] `Form` 加 `.scrollContentBackground(.hidden)` + `palette.bg`
  - [ ] `statusBadge` palette 化
  - [ ] `TextField` `.roundedBorder` 保留
  - [ ] 眼睛按钮 palette.muted
  - [ ] `grep "\.green\|\.red\|\.orange" SettingsView.swift` 空
  - [ ] 原生性审查：Tab / SecureField 焦点环 / VoiceOver
  - [ ] 视觉验收矩阵 8 截图（4 status × dark/light）

- [ ] **C8** `feat(macos): apply Basalt palette to PermissionGuideView`
  - [ ] Header icon 换 palette.accent
  - [ ] `PermissionRow` 套 `basaltCard(radius: Radius.widget)`
  - [ ] 权限状态色 palette 化
  - [ ] "All permissions granted" label palette.success
  - [ ] `grep "\.blue\|\.green\|\.red" PermissionGuideView.swift` 空
  - [ ] 原生性审查：Refresh Tab 可达 / VoiceOver
  - [ ] 视觉验收矩阵 6 截图

- [ ] **C9** `feat(macos): apply Basalt font ladder to AboutView`
  - [ ] 字号换 BasaltFont.pageTitle / body / caption
  - [ ] Divider 换 palette.border 0.5px Rectangle
  - [ ] 版权行 palette.mutedSubtle
  - [ ] padding(30) → Spacing.xl
  - [ ] `grep "\.font(\.title\|\.font(\.caption\|\.font(\.body" AboutView.swift` 空
  - [ ] 原生性审查：Link 系统 hover / VoiceOver
  - [ ] 视觉验收矩阵 6 截图（Dynamic Type × dark/light）

- [ ] **C10** `feat(macos): apply Basalt bg to MainWindowView detail area`
  - [ ] `MainWindowView` 加 `@Environment(\.palette)` +
        `.background(palette.bg)`
  - [ ] `TrayMenu` / `TrayLabel` / `InputDeviceMenu` **不动**
  - [ ] `elapsedTimer` 审计注释追加
  - [ ] 原生性审查：Menu bar 原生外观 / Cmd+, 打开
  - [ ] 视觉验收矩阵 8 截图（4 tab × dark/light）

### ✅ FINAL CHECKPOINT

- [ ] 全局 `xcodebuild test` 全绿
- [ ] 全局 `swiftlint --strict` 0 violations
- [ ] `bun run test` 229/229
- [ ] pre-commit / pre-push hook 全过
- [ ] 全局 grep 验收（palette / 硬编码色 / 固定字号）
- [ ] 手工冒烟：录音 → 停止 → 上传 → 播放 → 删除 → 权限重开 → 设置改 → dark/light 全路径
- [ ] Release notes 草稿

---

## Progress Snapshot

| Stage | 完成 | 总计 |
|-------|-----:|-----:|
| Stage 1 | 0 | 1 |
| Stage 2 | 0 | 3 |
| Stage 3 | 0 | 6 |
| **总计** | **0** | **10** |
