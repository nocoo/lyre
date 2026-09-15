# Lyre macOS 原生界面预览

[打开预览画廊](index.html) · [设计与实现说明](../../09-macos-ui-redesign.md)

画廊包含 33 个场景、66 张浅色与深色截图，包括自动上传、权限拒绝、输入设备断连、会议提醒、删除确认和错误提示。可切换页面、查看原图，并用 URL 中的片段定位具体场景，例如 `index.html#meeting-start-dark`。

`Preview.swift` 直接实例化 `apps/macos/Lyre/Views` 中的生产 SwiftUI 视图，只提供录音示例、波形和隔离的服务状态。它没有另一套仿制页面。菜单栏截图用预览宿主展示快捷面板内容，正式应用的页面导航全部使用同一个主窗口。

会议提醒通过生产 `LyreAlertPresenter` 显示并截取实际 NSPanel，同时确认它没有取得键盘焦点。录音错误也使用实际 presenter，并检查 sheet 已附着到预览主窗口。删除确认在预览主窗口中叠加生产共享组件；正式应用使用 sheet。

## 重新生成截图

需要完整 Xcode、macOS 图形会话，以及已安装的 `rg`。从仓库根目录运行：

```bash
bash docs/design/macos-2026-09-15/render.sh
```

默认覆盖本目录 `screenshots/` 下的 PNG。也可写到独立目录：

```bash
bash docs/design/macos-2026-09-15/render.sh /tmp/lyre-design-previews
```

只渲染指定场景：

```bash
LYRE_PREVIEW_PAGES=library,recording,compact-upload \
  bash docs/design/macos-2026-09-15/render.sh /tmp/lyre-design-previews
```

## 交互查看

```bash
bash docs/design/macos-2026-09-15/render.sh --interactive
```

在 **Design Preview** 菜单选择状态，通过侧栏检查实际页面导航。Cmd-Shift-D 切换预览外观。生产应用的菜单命令由 LyreApp 注册，这个隔离宿主只提供预览菜单。

脚本编译临时 App，退出时删除构建目录。配置和录音状态使用独立示例，不扫描个人录音、不修改生产配置、不启动捕获或 Teams 检测、不发送上传请求。播放、删除、上传按钮在预览环境中只改变示例状态；授权与 Finder 操作不执行。

截图通过 `SCShareableContent.currentProcess` 获取当前进程可用内容，再同时按窗口 ID 和进程 ID 选择预览窗口。截图关闭音频捕获。需要观察窗口尺寸时，可额外设置 `LYRE_PREVIEW_LAYOUT=1` 输出原生分栏尺寸。
