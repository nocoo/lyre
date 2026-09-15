# macOS 系统音频权限：已允许但仍提示授权

2026-09-15，针对 v2.0.0 的后续修复。用户反馈系统设置已经允许 Lyre 访问系统音频，应用仍显示 Allow access，并阻止开始录音。

[恢复界面 · 浅色](design/macos-system-audio-2026-09-15/permissions-recovery-light.png) · [恢复界面 · 深色](design/macos-system-audio-2026-09-15/permissions-recovery-dark.png)

## 发现

v2.0.0 的权限界面与录音入口均依赖 `CGPreflightScreenCaptureAccess()`。返回 false 时，初始状态一直停在 unknown；每两秒刷新、切回应用和点击录制，都重新调用同一个预检，因此不能解决进程内的旧值问题。

开源项目中有直接对应的记录。AltTab 明确指出该 API 的返回值在应用运行期间可能不更新，改用 `SCShareableContent` 检查可访问内容。Lyre 的现有逻辑确有这一缺口；本轮没有在用户正在运行的安装包里执行真实权限请求，因此不能断言本机症状只有这一种原因。

| 参考 | 实现与结论 | 本次采用 |
| --- | --- | --- |
| [AltTab · SystemPermissions.swift](https://github.com/lwouis/alt-tab-macos/blob/850a72351ac03b6509442b7a56f9bd9fad8fb24b/src/macos/SystemPermissions.swift#L161) | 说明 CG 预检的进程内旧值；通过 `SCShareableContent.getExcludingDesktopWindows` 验证，超时上限 6 秒；注明查询可能弹出系统授权框 | 实际框架查询、有界等待，以及后台检查与显式授权的区分 |
| [QuickRecorder · SCContext.swift](https://github.com/lihaoyun6/QuickRecorder/blob/e82051787f013ec2e811fcceab2d7de80e9d4dbe/QuickRecorder/SCContext.swift#L68) | 使用 ScreenCaptureKit 的结果，单独处理 `SCStreamError.userDeclined`；其他查询错误保留错误语义 | 区分拒绝授权与服务故障；不采用阻塞信号量、自动重复申请或强制退出 |
| [OBS · platform-osx.mm](https://github.com/obsproject/obs-studio/blob/caaa0223401f2195128f9998265a0f66d84c9a02/frontend/utility/platform-osx.mm) / [Cap · permission.rs](https://github.com/CapSoftware/Cap/blob/edb0747ac9bfc9ecdef5978838d01d714301a4a7/crates/scap-screencapturekit/src/permission.rs) | 相关权限辅助代码仍直接包装 CG 的预检 / 请求接口 | 单独引入这些包装不能修复 Lyre 的旧值问题 |
| [AudioCap · AudioRecordingPermission.swift](https://github.com/insidegui/AudioCap/blob/main/AudioCap/ProcessTap/AudioRecordingPermission.swift) | CoreAudio Process Tap 的独立音频权限示例，查询使用私有 TCC SPI | 不引入私有权限接口，也不为修复状态判断而重写录音管线 |

[Glimpse #15](https://github.com/rtemoni/Glimpse/issues/15) 也记录了设置已开启但引导页无法通过的类似现象。[Apple 的 ScreenCaptureKit 示例](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) 说明首次授权后可能需要重新启动应用才能开始捕获。

## Lyre 的处理

`ScreenCapturePermissionProbe` 通过公开的 ScreenCaptureKit 内容查询核验访问能力。没有开始音频捕获，没有查询 TCC 数据库，也没有新增第三方依赖。

- **被动检查**：启动、权限页的定时刷新和普通应用激活继续使用非交互式预检，不主动申请权限。
- **显式检查**：Check、Refresh，以及权限尚未确认时的录音准备，使用实际内容查询。通过 Lyre 的 Settings 按钮打开系统设置，返回后也检查一次。
- **实际结果优先**：查询成功后，旧的 false 预检不能把界面改回未授权；实际拒绝后，旧的 true 也不能把界面改成已允许。该结果只保存在当前进程内。
- **错误分类**：只有 `SCStreamErrorDomain` 下的 `userDeclined`（-3801）算明确拒绝。超时、服务失败、没有返回内容等显示可重试的检查问题；空显示器列表本身不是拒绝授权。
- **并发与迟到结果**：并发检查合并为一个任务，查询最长等待 6 秒；取消、超时后的回调只会被忽略。真实录制或会议窗口查询报告拒绝时，立即作废旧的检查结果。
- **重新打开**：权限页提供符合现有样式的恢复卡片。用户点击 Reopen 后，打开当前应用包的新实例并返回 Permissions 页面，成功启动新实例后才退出旧实例。录音或任一前台 / 后台上传进行中时不可重开；重开期间暂停会议提醒并禁用窗口操作，启动失败则恢复当前应用的提醒功能。

录音入口不再因 false 预检直接拒绝已经可以访问的录制请求；实际捕获仍由 ScreenCaptureKit 执行并校验访问。权限准备的查询暂时不可用时不创建录音文件，也不把问题说成用户拒绝。麦克风仍使用 AVFoundation 的独立授权状态。

## 两种系统设置选项与签名

当前录音管线通过 `SCShareableContent.current` 枚举显示器并建立 `SCContentFilter`，保存的是音频。它需要 **Screen & System Audio Recording（屏幕与系统音频录制）**；系统设置里的 **System Audio Recording Only（仅系统音频录制）** 不能作为这条路径已获授权的依据。[QuickRecorder 也明确解释了这一区别](https://github.com/lihaoyun6/QuickRecorder/blob/e82051787f013ec2e811fcceab2d7de80e9d4dbe/QuickRecorder/SCContext.swift#L246)。新的界面会说明应开启哪一项。

`SCShareableContent.currentProcess` 只能读取自己进程的有限内容，不能证明有全局捕获权限；它仅用于隔离预览截图，不能替代生产权限检查。

初次本机只读检查时，`/Applications/Lyre.app` 为 v2.0.0，bundle ID 是 `ai.hexly.lyre`，使用 ad-hoc 签名且没有 TeamIdentifier。更新后应用二进制身份变化可能使旧授权不适用于当前副本。这与界面误用 CG 旧值是两个需要分别处理的问题。跨版本身份稳定仍需要有效 Developer ID 签名及一致的 bundle ID；增加权限库或重试次数不能提供这种身份稳定性。

## 验证与复现边界

权限修复阶段的普通原生测试通过：**260 个测试定义，参数展开后 281 次通过，0 次失败，3 个真实录音测试跳过**。结果保存在 `test-results/macos/run-yrsevM/Tests.xcresult`。SwiftLint strict、关闭签名的 Release 构建与 `git diff --check` 均通过。

回归测试注入权限查询与系统设置打开动作，覆盖旧预检值、授权恢复、明确拒绝、服务故障、并发合并、超时、取消、迟到回调、录制启动 / 运行时拒绝，以及重新打开应用的上传与会议提醒保护。普通原生测试不会通过这些新增用例请求真实权限。

权限页面通过隔离宿主渲染 unknown、denied / recovery 和 granted 状态的深浅主题，共 6 张截图；恢复界面的截图保存在本文链接中。预览只获取宿主自身窗口的图像，不启动音频捕获。可用以下命令重现：

```bash
LYRE_PREVIEW_PAGES=permissions-unknown,permissions-recovery,permissions-ready \
  bash docs/design/macos-2026-09-15/render.sh /tmp/lyre-system-audio-preview
```

上述自动验证没有修改系统授权、重置 TCC 或录制真实音频。随后按用户要求编译本地签名的 Release 版，覆盖 `/Applications/Lyre.app`、解除隔离并启动；用户初步反馈权限问题似乎已解决。

同日后续界面调整统一了窗口与 sidebar 背后的底色、绿色就绪 / 琥珀色提醒 / 红色错误图标，以及“图标 + 单词”的操作按钮，并补齐 Play / Pause 菜单图标。这些调整随 v2.0.1 发布。发布预览检查了录音库、权限恢复、麦克风回退、上传失败、快捷录制和录音错误 6 个场景的深浅主题，共 12 张截图；本文恢复界面截图已更新。前述原生测试数据对应权限修复阶段，发布检查另由仓库提交与推送钩子执行。

v2.0.1 的 Release 归档和 DMG 已生成，支持 Apple Silicon 与 Intel，最低 macOS 15.0；磁盘镜像校验、应用版本和签名完整性检查通过。当前机器没有有效 Developer ID，安装包继续使用 ad-hoc 签名，未经过 Apple 公证。
