<p align="center">
  <img src="assets/brand/icon-rounded.png" alt="Lyre" width="128" height="128" />
</p>

<h1 align="center">Lyre</h1>

<p align="center">管理录音，把语音转成文字，并在回听时查看对应内容。</p>

<p align="center">
  <a href="https://lyre.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Lyre 是录音管理与语音转写平台。可以上传音频，在网页中发起转写、回听录音、查看文字和生成摘要；配套的 macOS 菜单栏应用用于录制麦克风与系统声音，再上传到同一服务。

一个 Cloudflare Worker 同时提供 Web 页面和 API，D1 保存录音资料与任务状态，阿里云 OSS 保存音频和原始转写结果。语音识别使用 DashScope，摘要使用单独配置的模型服务。

## 功能

- 上传音频，编辑标题、说明与笔记，通过文件夹、标签、搜索、状态筛选和分页整理录音。
- 发起或重新发起语音转写，查看任务状态；生产定时任务每分钟检查未完成任务，单个任务查询也能推进状态。
- 调整播放速度、拖动进度、按句跳转，查看与复制完整文字；词时间戳可用时支持逐词高亮和点击跳转。
- 手动生成中文摘要，或启用转写完成后的自动摘要；重新生成时可以附上修改意见。
- 导出与导入资料 JSON，手动推送备份到 Backy，或让 Backy 调用 Webhook 触发备份。
- 使用 macOS 菜单栏录音、跟随系统或指定麦克风并上传文件。Teams 会议提醒可在设置中开启，新安装默认关闭；提醒不抢焦点，录音启停始终由使用者确认。

## 使用

### Web

[站点](https://lyre.hexly.ai) 通过 Cloudflare Access 登录，需要获准的身份。部署者需先配置 OSS 与 DashScope；摘要功能还需要在 AI 设置中填写供应商、模型及凭据。

1. 上传音频并填写标题、说明或文件夹。网页单文件上限为 500 MiB。
2. 打开录音详情，手动发起转写。上传完成本身不会自动开始转写。
3. 转写完成后回听并查看文字；可生成摘要、补充笔记或下载音频。

未配置 `DASHSCOPE_API_KEY` 时，服务使用模拟 ASR，返回示例文字。真实转写与模型摘要需要对应服务的有效配置。词级视图还依赖 OSS 中已归档的原始转写结果。

### macOS 客户端

客户端需要 macOS 15 或更新版本，源码打包步骤见[macOS 构建与配置](docs/08-development.md#macos-构建与配置)。在网页的 Device Tokens 中创建 Token，填入客户端设置中的服务地址与 Token，再在应用的权限页面授予麦克风和屏幕 / 系统音频录制权限。

录音默认保存在 `~/Music/Lyre Recordings/`。停止后可在客户端查看并上传；客户端默认分别保存系统与麦克风音轨，上传前尝试混为单轨，原始本地文件保留。

### 资料备份

Settings 中的 JSON 备份包含录音资料、转写文字、设置与设备 Token 哈希；设置中可能含有模型或 Backy API Key。音频与 OSS 中的原始转写文件需要另外备份。导入按 ID 合并或更新已有资料，细节见[备份与存储范围](docs/08-development.md#备份与存储范围)。

## 开发

Web / Worker 开发需要 Bun 和 Node.js 22+，后者是当前锁定 Wrangler 的要求。先在独立开发副本中安装依赖并构建静态资源：

```bash
git clone https://github.com/nocoo/lyre.git
cd lyre
bun install --frozen-lockfile
bun run build
```

本地测试环境的初始化 SQL 会删除并重建表。只在可丢弃的本地状态上执行：

```bash
cd apps/api
bunx wrangler d1 execute lyre-db-test --env test --local --file ../../e2e/schema.sql
cd ../..
```

两个终端分别启动：

```bash
bun run worker:dev
```

```bash
bun run web:dev
```

Worker 使用仅供本地开发的 `test` 环境，端口为 7017；Vite 在端口 7016 将 `/api` 代理给它。本地测试身份已配置，空白界面和资料管理无需真实云端凭据。真实 OSS 上传与 ASR 另有配置前提，见[本地环境](docs/08-development.md#本地环境)。

```text
apps/web/          React 页面、播放器与转写视图
apps/api/          Hono Worker、鉴权、API 与定时任务
apps/macos/        SwiftUI 菜单栏录音应用
packages/api/      共享契约、处理函数、数据访问与服务
```

`bun run build` 把 Web 产物写入 `apps/api/static`；`bun run typecheck` 检查 TypeScript，`bun run lint` 检查代码风格。main 的 CI 成功后由 Release 自动部署 Worker，D1 迁移需另行处理。`test` 环境供本地使用，仓库没有 `deploy:test` 命令。

## 测试

从仓库根目录运行：

| 范围 | 命令 |
| --- | --- |
| Web、Worker、共享 API 与开发脚本单元测试 | `bun run test` |
| 单元测试与覆盖率报告 | `bun run test:coverage` |
| 本地 HTTP API 集成 | `bun run test:e2e` |
| 浏览器测试 | `bun run test:e2e:bdd` |

HTTP 集成使用端口 7017，浏览器使用端口 27016；两者都应用 `e2e/schema.sql`，会重建同一个本地测试 D1 状态。使用独立副本、顺序运行，并先释放端口。浏览器测试还需要 Web 构建和 Chromium，可用 `bunx playwright install chromium` 安装。不要为普通本地验证提供真实服务凭据；真实 ASR 测试的单独启用条件见[测试入口](docs/08-development.md#测试入口)。

macOS 测试需要完整 Xcode 和 macOS 15+，从仓库根目录运行：

```bash
bun run test:macos
```

默认入口不启用真实录音。测试工具链设置、结果位置和真实录音的单独启用条件见[macOS 测试前提](docs/08-development.md#macos-测试前提)。

## 技术栈

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)
![Swift](https://img.shields.io/badge/Swift-F05138?logo=swift&logoColor=white)

| 部分 | 实现 |
| --- | --- |
| Web | React、Vite、React Router、SWR、Tailwind CSS、Basalt、Recharts |
| 服务与数据 | Hono、Cloudflare Workers、D1、Drizzle ORM |
| 音频存储与转写 | 阿里云 OSS、DashScope 异步文件转写 |
| 摘要 | Vercel AI SDK、@nocoo/next-ai、Markdown 渲染 |
| 认证 | Cloudflare Access、jose、设备 Bearer Token |
| macOS | Swift、SwiftUI、ScreenCaptureKit、AVFoundation |
| 验证 | Vitest、Playwright、Swift Testing、Biome、SwiftLint |

## 文档

- [文档索引](docs/README.md)
- [当前开发、配置与部署说明](docs/08-development.md)
- [Backy 集成](docs/02-backy.md)
- [macOS 音频管线设计](docs/06-macos-audio-pipeline-redesign.md)
- [Teams 会议检测](docs/07-teams-meeting-detector.md)

## 许可证

[MIT](LICENSE) © 2026 Zheng Li
