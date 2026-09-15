# 当前开发与运行说明

[中文 README](../README.md) · [English README](README.en.md) · [文档索引](README.md)

## 入口与数据流

Vite 构建 `apps/web`，产物直接写入 `apps/api/static`；`apps/api/wrangler.toml` 的 ASSETS 绑定提供 SPA，`/api/*` 由同一个 Hono Worker 处理。`packages/api` 是共享库，生产使用 D1 / Drizzle，不另起 Node 服务。

网页上传依次执行预签名请求、浏览器直接 PUT 到 OSS、创建 D1 录音记录。上传完成后需要手动发起转写。预签名接口要求 `audio/*` MIME；500 MiB 是网页的文件大小限制，预签名接口没有相同的大小检查。

DashScope 使用异步文件转写模型，默认 `qwen3-asr-flash-filetrans`。Worker 每分钟轮询活动任务，`GET /api/jobs/:id` 也能推进任务；SPA 的任务提示使用轮询。完成后把句级文字存入 D1，并尽力把原始结果归档到 OSS，词级视图从该归档读取时间戳。

自动摘要需要设置开启且供应商 / API Key 有效；摘要失败单独记录，不把已经完成的转写改成失败。手动摘要通过文本流返回，可附修改意见重新生成。当前摘要提示词统一要求简体中文输出，专有名称与代码标识保留原文。

## 本地环境

安装 Bun 与 Node.js 22+。冻结安装后运行 `bun run build`，静态资源会写入 `apps/api/static`。`web:dev` 监听 7016，固定代理 `http://localhost:7017`；`worker:dev` 运行 `wrangler dev --env test`，监听 7017。

本地环境使用 `lyre-db-test`，默认运行在本机 Wrangler 状态目录。`e2e/schema.sql` 明确执行 DROP + CREATE；在新副本或可丢弃的开发数据库中初始化：

```bash
cd apps/api
bunx wrangler d1 execute lyre-db-test --env test --local --file ../../e2e/schema.sql
cd ../..
```

之后在两个终端分别运行 `bun run worker:dev` 与 `bun run web:dev`。`env.test` 的 `E2E_SKIP_AUTH=true` 会映射为内部测试身份标志，只有非 production 环境生效。这个环境仅供本地运行，不应部署。

不要把真实 `.dev.vars` 带入普通测试副本。测试与日常本地开发都使用 `apps/api/.wrangler/state`；HTTP 和浏览器测试即使端口不同，仍重建同一个测试数据库。

### 外部服务配置

| 配置 | 用途与来源 |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Access 团队子域，不含 `.cloudflareaccess.com` 后缀 |
| `CF_ACCESS_AUD` | Access 应用 audience |
| `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | OSS 访问凭据 |
| `OSS_BUCKET`、`OSS_REGION`、`OSS_ENDPOINT` | OSS Bucket 与区域 / Endpoint 配置 |
| `DASHSCOPE_API_KEY` | 真实语音转写 |
| AI 设置中的供应商、模型、Key、可选 Base URL | 用户在网页保存的摘要服务配置，存入 D1 settings |

Worker 从绑定 / vars / secrets 读取这些值。OSS 浏览器直传需要允许站点来源和 PUT 的 CORS 配置。`test` 环境的 `OSS_BUCKET` 仍写为 `lyre`；提供真实 OSS 凭据前需显式改用自己的独立测试 Bucket，环境名不会替你隔离阿里云资源。

没有 DashScope Key 时会选择 mock ASR，即使其他资源已配置也只返回示例结果。Mock ASR 不替代 OSS 预签名和存储配置，因此无凭据本地环境中的上传、播放 URL 或转写提交可能返回配置错误。

## macOS 构建与配置

项目使用 Swift 6，最低 macOS 15，工程定义要求 Xcode 16+ 与 XcodeGen 2.40+。已有 `Lyre.xcodeproj` 可直接构建：

```bash
cd apps/macos
xcodebuild build -project Lyre.xcodeproj -scheme Lyre \
  -configuration Debug -destination 'platform=macOS' \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
cd ../..
```

如果当前命令行目录指向 Command Line Tools，可在 `xcodebuild` 命令前设置 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`，使用已安装的完整 Xcode。修改 `project.yml` 后再运行 `xcodegen generate`。

打包命令从仓库根目录执行：

```bash
LYRE_CODE_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
LYRE_DEVELOPMENT_TEAM=TEAMID bun run macos:dmg
```

脚本先验证签名身份，再删除并重建仓库 `build/`、重新生成 Xcode 工程、archive，产生 `build/Lyre-<version>.dmg`。本地临时构建可显式使用 `LYRE_ALLOW_ADHOC=1 bun run macos:dmg`，但更换 ad-hoc 构建可能导致麦克风重新授权。正式版本应保持稳定的 Developer ID 身份；脚本没有 notarization 步骤，分发前需另行公证。GitHub Release 附件由维护者上传。

客户端默认服务器为 `https://lyre.hexly.ai`，用网页生成的设备 Token 认证；服务地址可在设置中修改。配置位于 `~/Library/Application Support/Lyre/config.json`，包含 Token，当前实现未将它存入 Keychain。录音默认目录为 `~/Music/Lyre Recordings/`，可在设置中修改。

麦克风与系统音频由 ScreenCaptureKit 采集，默认双轨写入本地 M4A；可用时生成音轨角色的 `.tracks.json` 旁文件。上传前尝试混为单轨以适配网页播放，混音失败时回退上传原文件，可能影响浏览器播放；本地原文件不被替换。

自动输入跟随 macOS 当前输入设备；指定的麦克风暂时断连时保留偏好并回退，重连后恢复。自动上传默认关闭，默认时长阈值为 5 分钟，成功保存且严格超过阈值才会触发。

Teams 提醒在新安装时默认关闭，升级保留已有设置。提醒不抢焦点且会自动消失；停止建议只针对从会议提醒开始的同一次录音，所有启停均需用户选择。它依赖本机音频、窗口观察和已有权限，不能把提醒当作会议参与或录音成功的证明。实现和验证边界见[可靠性优化](10-macos-recording-reliability.md)。

## 备份与存储范围

录音、任务、文件夹和标签接口按当前用户过滤。Storage 页面则扫描整个已配置 OSS Bucket 的 uploads / results；清理接口核对对象是否失去数据库关联，当前只要求登录，没有独立的管理员角色检查。该页面适用于受信任的部署管理场景。

普通录音删除先删除 D1 关联记录，再尽力删除 OSS 音频和任务结果；OSS 清理失败不会撤销 D1 删除。需要清理遗留对象时使用 Storage 页面核对。

JSON 备份包含用户资料、文件夹、标签、录音资料、转写任务与文字、设备 Token 哈希和全部用户设置。设置可能含 AI / Backy 凭据；它不包含 OSS 音频、原始转写对象或 Worker secrets。

导入按 ID 更新或插入资料，并更新对应设置，不清空 JSON 中未列出的其他记录。应使用来源可信、属于自己的备份，避免 ID 冲突覆盖现有资料；音频对象仍需在 OSS 中存在才能播放。

Backy Push 使用设置中的 webhook URL 与 API Key。`/api/backy/pull` 接受 HEAD / POST，以 `X-Webhook-Key` 校验身份；POST 触发本应用生成并推送备份，不会从 Backy 导入资料。若入口前有 Cloudflare Access，机器端点也需相应的边缘访问策略。

## 测试入口

| 命令 | 前置条件与范围 |
| --- | --- |
| `bun run test` | Vitest；Web / Worker / API 库与开发脚本单元测试 |
| `bun run test:coverage` | 同一套测试与覆盖率报告 |
| `bun run test:e2e` | 端口 7017；本地 Wrangler、DROP + CREATE 测试 schema、真实 HTTP；没有静态资源时自动构建 |
| `bun run test:e2e:bdd` | Web 已构建、Chromium、端口 27016；本地 Worker 与同一个测试 D1 状态 |

`bunx playwright install chromium` 安装浏览器。Playwright 非 CI 模式会复用已有服务，因此运行前需确认对应端口空闲，且 HTTP / 浏览器套件顺序运行。HTTP 帮助函数支持 `E2E_BASE_URL`，普通本地执行应保留默认本机地址。

无外部服务配置时，部分 HTTP 用例允许预期的配置错误状态，不代表真实音频上传或云端 ASR 已验证。`e2e/api/asr-multitrack.test.ts` 仅在 `LYRE_RUN_LIVE_ASR=1` 时执行真实 OSS 上传和 DashScope 请求；它需要独立云端资源与凭据。

### macOS 测试前提

从仓库根目录运行 `bun run test:macos`，需要完整 Xcode 和 macOS 15+。若全局工具链仍指向 Command Line Tools，可以只为本次命令指定：

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer bun run test:macos
```

两个共享 scheme 的 Test action 使用空的 Debug 应用宿主，不构造日常 `LyreApp`，因此不会从应用启动流程读取个人配置、扫描录音目录、启动 Teams 检测或打开权限页面。普通用例仍会操作各自的临时文件、合成音频与网络替身，并可枚举音频设备。正常 Debug Run 和 Release 构建保持日常应用入口。

默认命令关闭真实录音，即使调用环境中已有录音开关也会覆盖为关闭。结果保存在命令打印的 `test-results/macos/run-*/Tests.xcresult`；成功后仅删除本轮 DerivedData，失败或中断时保留构建诊断。SwiftLint 从 `apps/macos` 运行 `swiftlint lint --strict Lyre/ LyreTests/`，也需要完整 Xcode 工具链。

需要实际验证录音时，在允许采集系统声音和麦克风的环境中单独运行：

```bash
LYRE_RUN_LIVE_RECORDING=1 bun run test:macos:live
```

这个显式入口会真实录音，需要已有屏幕 / 系统音频录制与麦克风权限以及可用显示器。测试不会弹出权限申请；缺少前提时会失败。录音用例顺序执行，先等待停止，再清理各自的临时文件。普通测试在权限检查之前跳过这些用例。仅需要编译时使用上面的 `xcodebuild build`。

## 部署

main 推送触发 CI；成功后 Release 检出该提交，构建 Web 并部署 Worker，main 路径检查 `/api/live` 返回 200。tag 路径另核对版本。这个流程没有 D1 迁移步骤，也不自动附加 macOS DMG。

生产 SQL 位于 `packages/api/migrations/`，需按顺序应用尚未执行的迁移。Wrangler 配置没有指向该目录的 `migrations_dir`，不能假设 `wrangler deploy` 或默认迁移命令会自动处理。旧迁移指南中为新库遍历全部 SQL 的例子也不适合反复对已有库执行。

自行部署需要配置 D1、OSS、DashScope、Access 和 CI 凭据。浏览器身份由 Access JWT 校验，设备 Token 在 Worker 内校验；边缘策略必须允许设备与 Webhook 请求到达相应 API。`bun run deploy` 会部署生产 Worker，`deploy:test` 并不存在。
