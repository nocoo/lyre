# 03 — Cloudflare Worker 迁移计划（API 抽离 → Web 重写 → CF Access）

> 目标：把 Lyre 现有 Next.js 16 单体（apps/web）拆成
>   ① `@lyre/api`（framework-agnostic 业务逻辑包）
>   ② `apps/api`（Hono on Cloudflare Workers，Bearer 鉴权）
>   ③ `apps/web`（Vite SPA，登录改 CF Access）
> 同时把现 `apps/web` 整体重命名为 `apps/web_legacy` 冻结归档，作为回滚物料与功能对照参照。
>
> 参考已完成的迁移：
> - `../backy/docs/06-api-extraction-plan.md` —— @backy/api 抽离的 wave 划分、HandlerResponse 协议、Coverage 双 workspace 门禁
> - `../backy/docs/07-vite-web-migration-plan.md` —— Vite + Worker + CF Access 端到端落地（运行时上下文抽象、Access JWT 校验、`[assets]` SPA 托管、流式上传重写）
> - `../surety/apps/worker` —— Hono + `accessAuth` + `apiKeyAuth` 双轨鉴权范式（Web 端走 Access、CLI/macOS 端走 Bearer）
> - `../bat` —— 同栈 SPA + Worker 项目结构
>
> 本计划**不保留 Next.js 兼容层**，不做平滑切换。`web_legacy` 仅作为只读参照与
> 紧急回滚物料；新栈跑稳后整体删除。

## Status legend

- ⬜ pending
- 🟡 in progress
- ✅ done

---

## 一、终态目录

```
apps/
  web_legacy/                 # 现 apps/web 整体重命名归档；只读、不再开发
    ...                       # Next.js 16 + NextAuth + better-sqlite3 完整快照
  web/                        # NEW — Vite SPA（React 19 + react-router 7 + SWR）
    index.html
    vite.config.ts
    src/
      main.tsx
      App.tsx                 # react-router routes 装配
      lib/
        api.ts                # fetch wrapper（credentials:"include"，401 → 触发 Access 重登）
        utils.ts              # cn()
        version.ts
        format.ts
      pages/                  # 一一对应原 Next.js 路由
        dashboard.tsx         # /
        recordings-list.tsx   # /recordings
        recording-detail.tsx  # /recordings/:id
        settings.tsx          # /settings
        settings-ai.tsx       # /settings/ai
        settings-storage.tsx  # /settings/storage
        settings-tokens.tsx   # /settings/tokens
      components/             # 从 web_legacy 平移：layout/ ui/ + 业务组件
      hooks/
        use-me.ts             # SWR /api/me
        use-job-poll.ts       # SWR refreshInterval 轮询 /api/jobs/:id；终态后停
    public/
    e2e/                      # Playwright，连 wrangler dev
  api/                        # NEW — Hono on Cloudflare Workers
    wrangler.toml
    src/
      index.ts                # Hono app 装配 + scheduled() 入口
      lib/
        types.ts              # AppEnv（Bindings + Variables）
      middleware/
        access-auth.ts        # CF Access JWT（Web 端）
        bearer-auth.ts        # device-token Bearer（macOS 客户端）
        is-localhost.ts
        runtime.ts            # 构造 RuntimeContext（DB / OSS / env / info）注入
      routes/
        recordings.ts         # 调 @lyre/api/handlers/recordings.*
        recording-item.ts     # /:id 子树（play-url、download-url、words、transcribe、summarize）
        folders.ts
        tags.ts
        search.ts
        dashboard.ts
        upload.ts             # /upload/presign
        jobs.ts               # /jobs/:id（无 SSE，前端 SWR 轮询）
        me.ts                 # GET /api/me — 返回 { email, name, avatarUrl } 详见决策点 6
        settings.ts           # /settings/* 全家桶
        backy.ts              # /backy/pull（HEAD + POST，X-Webhook-Key 鉴权）
        live.ts
    static/                   # vite build 产物（apps/web 构建到此目录）
packages/
  api/                        # NEW — @lyre/api，framework-agnostic
    src/
      lib/                    # 纯工具 + 持久化 + 第三方集成
        db/{schema,index,utils}.ts
        db/repositories/{users,recordings,folders,tags,jobs,transcriptions,settings,device-tokens}.ts
        oss/{client,signer}.ts
        asr/{provider,dashscope,mock}.ts
        ai/{summarize,providers}.ts
        backup/{export,import}.ts
        backy/{push,pull}.ts
      handlers/               # 业务逻辑，返回 HandlerResponse
        recordings.ts
        folders.ts
        tags.ts
        search.ts
        dashboard.ts
        upload.ts
        jobs.ts
        settings.ts
        backy.ts
        live.ts
        http.ts               # HandlerResponse 类型 + json/empty/bytes/text/stream 构造器
      runtime.ts              # RuntimeContext 接口（DB / OSS / Env / Info / Clock）
      index.ts                # 选择性 re-exports
```

> 根 `package.json` workspace 通配 `apps/*` + `packages/*` 已涵盖；scripts 在 Wave E 切换。

---

## 二、关键差异 vs backy 迁移（务必先读）

backy 的迁移可以直接照搬绝大部分动作，但 **lyre 有四处显著不同**，决定了
本计划必须额外加章节处理：

| 维度 | backy 现状 | lyre 现状 | 影响 |
|---|---|---|---|
| **持久化** | D1（Worker binding） | **better-sqlite3 本地文件** + Drizzle ORM | Worker 跑不了 better-sqlite3，**必须换 DB**。详见「决策点 1」 |
| **后台任务** | 仅 `scheduled()` 触发 webhook 拉取 | `JobManager` **进程内常驻轮询单例**（每 N 秒轮询所有 RUNNING 的 ASR 任务） | Worker 无常驻进程；必须改架构。详见「决策点 2」 |
| **实时推送** | 无 | `/api/jobs/events` 是 **SSE**（job-event-hub fan-out） | Workers 支持 streaming response，但需要 KV/DO 做 fan-out（多实例）。详见「决策点 3」 |
| **客户端鉴权** | 仅 Web | Web + **macOS 原生客户端（已用 device-token Bearer）** | 双轨鉴权一开始就要双跑：Access for Web, Bearer for macOS。沿用 surety `accessAuth` + `apiKeyAuth` 模式 |
| **大文件上传** | webhook FormData → R2 | 已是**预签名直传 OSS**（不经 server body） | ✅ 与 Worker 天然兼容，无需 backy Wave B' 那种流式重写 |

后两条是好消息（鉴权模式现成、上传不踩坑），前三条是这份文档要重点拆解的。

---

## 三、决策点（已锁定 — 2026-04-26）

> 哥已 review 并拍板，全部按各项「推荐」执行，功能保持与 web_legacy 一致。

| 决策 | 选择 | 备注 |
|---|---|---|
| 1. 持久化 | **A — Cloudflare D1** | `lyre-db`（prod）+ `lyre-db-test`（e2e）已建好 |
| 2. JobManager 架构 | **A + C 混合** | Cron Trigger 1 分钟批量轮询 + 前端 SWR `refreshInterval` |
| 3. `/api/jobs/events` SSE | **B — 删除** | 删 `JobEventHub` / `use-job-events` / `/api/jobs/events`，改 SWR 轮询 |
| 4. macOS 客户端 | **双轨保留** | worker 同挂 `accessAuth` + `bearerAuth`，macOS 端无改动；端点清单见第四节鉴权矩阵 |
| 5. 第三方 SDK | OSS Web Crypto 重写一处签名；DashScope/AI SDK 直接可用；`@nocoo/next-ai` Wave B 评估替换 |
| 6. `/api/me` 契约 | **`{ email, name, avatarUrl }`** | 不能仅返回 email — 现 sidebar 依赖 `session.user.{name,image}` 渲染头像/昵称/首字母；CF Access JWT payload 含 `email`、`name`，头像取 DB `users.avatar_url`（Drizzle 字段名 `avatarUrl`，NextAuth 时代沉淀的 Google 头像），无则返回 `null`，前端用 `name[0]` 首字母兜底，不引入 Gravatar。详见决策点 6 章节 |
| 7. AI 配置 client-safe 契约 | **`@lyre/api/contracts`** 子路径 | UI 组件不能直接 import `services/ai`（内含 `@nocoo/next-ai/server`）；Wave B 必须先抽 client-safe types + provider metadata 暴露在 `@lyre/api/contracts`，server-only 代码留在 `@lyre/api/services` |
| 8. SSE 删除时序 | **legacy 期间保留 SSE，Wave D 切换后删** | 删除时机调整：legacy 仍消费 `use-job-events`；Wave B 仅做物理迁移（services 进 packages/api，但 `JobManager` + `JobEventHub` 仍可在 Next.js 进程内常驻）；新 worker 一开始就**不实现** `/api/jobs/events`，新 SPA 一开始就用 SWR 轮询；DNS 切到 worker 后 legacy 自然失效，删除 SSE 代码留到 Wave E 清理。详见决策点 8 章节 |
| Access Team | `nocoo` | `nocoo.cloudflareaccess.com` |
| Access AUD | `0f089ac6583cf2b12ee6cf4f358291365fbe9fe400580d094b44626632fcfa25` | lyre 单独的 Access application |

### 决策点 6 — `/api/me` 契约

最终 shape：

```ts
// GET /api/me 200
type MeResponse = {
  email: string;        // Access JWT email 或 device-token 关联用户邮箱
  name: string;         // CF Access JWT payload.name；fallback 用 email 前缀
  avatarUrl: string | null;
                        // 来源：DB users.avatar_url（Drizzle 字段名 users.avatarUrl，NextAuth 时代沉淀的 Google 头像）
                        // 无则 null；前端用 name[0] 首字母兜底（不引入 Gravatar 等外部依赖）
};
```

实现要点：
- worker `routes/me.ts` 拼装时，从 `c.get("accessEmail")` + JWT payload 拿 name；用 email 查 `users` 表读 `avatarUrl` 列（schema: `apps/web/src/db/schema.ts` 字段 `avatarUrl` → SQL 列 `avatar_url`）做 avatarUrl
- device-token 路径下：用 `tokenUser.userId` 查同一张表
- 前端 sidebar `useMe()` 数据形状与现 `useSession().user` 完全对齐（`name` / `image` → `name` / `avatarUrl`），改动量最小

### 决策点 7 — `@lyre/api` 与前端的客户端契约边界

问题：`apps/web/src/components/ai-settings.tsx` 当前直接 import `@/services/ai`
读 provider registry 与类型，而 `services/ai.ts` 顶层 `import "@nocoo/next-ai/server"`
等服务端依赖。如果 Wave D 让新 SPA 直接 import `@lyre/api/services/ai`，会把
server-only 代码（含 secrets、Node 内置模块）打进浏览器 bundle。

解法：`@lyre/api` 显式分两层 `exports`：

```jsonc
// packages/api/package.json
{
  "exports": {
    ".":            "./src/index.ts",                 // 仅 server 用
    "./contracts":  "./src/contracts/index.ts",        // ★ client-safe：types、enums、provider metadata
    "./contracts/ai": "./src/contracts/ai.ts",
    "./contracts/recordings": "./src/contracts/recordings.ts",
    // ...
    "./services/ai":  "./src/services/ai.ts",         // server only（带 @nocoo/next-ai/server）
    "./handlers/*":   "./src/handlers/*.ts",
    "./runtime":      "./src/runtime.ts"
  }
}
```

强约束：
- `packages/api/src/contracts/**/*` **不允许** import `node:*`、`@nocoo/next-ai/server`、`drizzle-orm/d1`、`hono/*` 等运行时模块；只放纯 type + 数据常量
- `apps/web/src/**` **只允许** import `@lyre/api/contracts/*`，不准 import `@lyre/api`、`@lyre/api/services/*`、`@lyre/api/handlers/*`
- ESLint `no-restricted-imports` 规则在 `apps/web/eslint.config.mjs` 强制
- Wave B 第一个动作：先把 `services/ai.ts` 顶部的 provider metadata（id、displayName、model 列表、validation schema）抽到 `contracts/ai.ts`，server 侧 re-import 这个 contracts；UI 端切换 import path

类似的"前端用了 server module"高风险点（Wave B 启动时全量盘点）：
- `@/services/ai` ← `ai-settings.tsx`
- `@/services/oss` ← `oss-storage.tsx`（如果有）
- `@/services/asr` 类型 ← `transcript-viewer.tsx`（如果有）
- `@/lib/types` 是否纯类型（应是；如混入 runtime 代码需拆）

### 决策点 8 — SSE 删除时序

目标"功能保持"与"删 SSE"看似冲突，实际是**时序问题**：

| 阶段 | legacy SSE | 新 worker | 新 SPA |
|---|---|---|---|
| Wave A | ✅ 保留运行 | — | — |
| Wave B | ✅ 保留运行（job-manager / job-event-hub / use-job-events 物理移到 packages/api，legacy `apps/web_legacy` 仍可调，next 进程内常驻 JobManager） | — | — |
| Wave C | ✅ 保留运行 | ❌ **不实现** `/api/jobs/events`；不挂 JobManager 单例；改用 Cron Trigger | — |
| Wave D | ✅ 保留运行 | ✅ Cron 轮询 + GET `/api/jobs/:id` | ❌ **不消费** SSE；用 SWR `refreshInterval: 5s` 轮询 `/api/jobs/:id`，状态终态后停 |
| Wave E（DNS 切流后） | 🟥 自然失效（legacy 已下线） | — | — |
| Wave E 清理 | 🗑️ 随 `apps/web_legacy/` 整目录删除一并消失；不需要单独 commit | — | — |

修正：
- ❌ ~~"Wave B 删除 services/job-manager*.ts、services/job-event-hub.ts"~~ ← 错误，不能删，legacy 还在用
- ✅ Wave B 仅做"物理迁移到 packages/api"，行为零变化；legacy 测试列表（`apps/web/package.json` 里的 job-manager / job-event-hub / use-job-events 测试用例）原样保留
- ✅ 新 worker / 新 SPA 一出生就不挂 SSE
- ✅ SSE 代码消亡 = `apps/web_legacy/` 目录删除（Wave E 收尾）

详细原选项分析见下文（保留作为决策依据档案）。

---

## 三-附录、决策候选分析（仅供回查，已锁定的不必再读）

### 决策点 1 — 持久化方案

现状 `better-sqlite3` + 本地文件，Worker 不可用。三个候选：

| 选项 | 说明 | 工作量 | 风险 |
|---|---|---|---|
| **A. Cloudflare D1** | 把 Drizzle dialect 从 `better-sqlite3` 换成 `drizzle-orm/d1` + 走 Worker binding；本地用 `wrangler dev --local`（miniflare 内置 SQLite 模拟）；legacy 期间不切 dialect，仅 worker 一侧实施 | **中**（D1 dialect 切换 + 全量回归 schema/查询语法差异；legacy 不切，省掉双 dialect 兼容层） | 复杂查询语法兼容性、文件大小限制（10GB/db）、写吞吐 |
| **B. Cloudflare Hyperdrive + 外部 Postgres** | 接 Neon/Supabase；Drizzle 换 `drizzle-orm/postgres-js` | 高（schema 重写 + 数据迁移） | 跨 region 延迟、外部依赖、成本 |
| **C. 保留 Railway 上的 SQLite，仅 Worker 跑无状态业务，DB 操作通过内网 RPC 回到 Railway 服务** | 不真正"Worker 化"，只把 Web/UI 切 Vite | 低 | 没解决"Worker 部署"的目标，且增加跨服务调用 |

**推荐：A（D1）**。理由：① 与 backy 一致，drizzle 切 `drizzle-orm/d1` + Worker binding 路径成熟；
② 数据规模（音频元数据 + 转写句子）远低于 D1 上限；③ 大对象（录音文件、ASR
result JSON）本来就不在 SQLite 里，存 OSS。

> ⚠️ 此项确认前**不要进入 Wave B**。Wave A（重命名归档 + 脚手架）可以先动。

### 决策点 2 — JobManager 后台轮询架构

现 `JobManager`（`apps/web/src/services/job-manager.ts`）：
- 进程启动时 lazy init，从 DB 加载所有 RUNNING/PENDING 的 ASR 任务
- 每 `POLL_INTERVAL_MS` 轮询所有任务的 DashScope 状态
- 状态变更回调 `JobEventHub` → SSE 推送给前端

Worker 无常驻进程，必须重新设计：

| 选项 | 说明 | 适配成本 |
|---|---|---|
| **A. Cloudflare Cron Trigger 周期触发** | `[triggers].crons = ["* * * * *"]`，每分钟扫一次 RUNNING 任务批量轮询 DashScope；事件通过 KV/DO 推送 | 中（最低分辨率 1 分钟，前端体验略降级） |
| **B. Durable Object 当作"轻量长连接"** | 每个 active job 起一个 DO，DO 内部用 alarm() 自我唤醒轮询；终态后销毁 | 高（DO 是付费功能、状态管理复杂） |
| **C. 客户端轮询（前端 SWR refreshInterval）** | 完全去后端轮询，前端在录音详情页打开时主动 GET `/api/jobs/:id` | 低（最简单，但用户离开页面后 job 状态不会前进） |
| **D. 提交 ASR 时同步等待短任务、长任务交 Cron** | 短录音（< 30s 转写）走同步；长任务才进 Cron | 中 |

**推荐：A + C 混合**。理由：Cron 1 分钟分辨率对"几分钟到十几分钟才完成的转写"
完全够用；前端打开详情页时 SWR `refreshInterval: 5s` 顶替 SSE 实时性。SSE 在
Worker 上能跑（见决策 3），但仅在用户停留详情页时生效，节省 Worker invocation。

### 决策点 3 — SSE `/api/jobs/events` 在 Worker 上的实现

Workers 支持流式 `Response`（`ReadableStream`），SSE 协议本身可行。但
**多实例 fan-out** 需要外部协调：

| 选项 | 说明 |
|---|---|
| **A. Durable Object 做 hub** | 单 DO 维护订阅集合，Cron Trigger（决策 2A）触发后通过 DO websocket/RPC 推送 |
| **B. 退化为前端轮询** | 如果决策 2 选了 C（客户端轮询），SSE 直接删除，前端用 SWR `refreshInterval` |
| **C. KV pub/sub 替代** | KV 不支持订阅；只能轮询 KV 标记 → 等于退化轮询 |

**推荐：B**。即决策 2 选 A+C 混合 → SSE 不必保留。删除 `JobEventHub` /
`use-job-events` / `/api/jobs/events`，前端详情页用 SWR `refreshInterval: 5s`
直到状态进入 SUCCEEDED/FAILED 后停止刷新。简化 Worker 部署。

### 决策点 4 — macOS 客户端兼容期策略

`apps/macos` 已经走 device-token Bearer 调 `/api/upload/presign` 等接口。新
worker 同时挂 `accessAuth`（Web）+ `bearerAuth`（device token）即可保持兼容。
**无需 macOS 端改动**，前提是：
- worker 域名与 Railway 域名一致（DNS 切换即可，token 不失效）
- 或 macOS 端通过设置页改 server URL（已支持）

需在 Wave E 切换 DNS 前，文档化迁移说明发给客户端持有者。

### 决策点 5 — Aliyun OSS / DashScope / AI SDK 在 Worker 上的可用性

| 模块 | 现实现 | Worker 兼容 |
|---|---|---|
| OSS | zero-SDK 自定义 V1 签名（`crypto`） | ✅ Web Crypto 替换 Node `crypto`（一处签名实现） |
| DashScope | `fetch` + Bearer | ✅ 直接可用 |
| Vercel AI SDK + `@ai-sdk/openai` / `@ai-sdk/anthropic` | 标准 fetch 流式 | ✅ 已知在 Workers 兼容 |
| `next-ai`（@nocoo/next-ai） | Next.js 专用 | ❌ 需替换为 AI SDK 直调或自实现 |
| Drizzle ORM | sqlite/d1/pg | 取决于决策 1 |

→ Wave B 处理 OSS 签名的 Web Crypto 替换；`@nocoo/next-ai` 需评估替换成本（如果
仅是简单封装，直接换 `ai` SDK 调用）。

---

## 四、CF Access 配置

| 项 | 值 |
|---|---|
| Team | `nocoo` (`nocoo.cloudflareaccess.com`) |
| AUD | `0f089ac6583cf2b12ee6cf4f358291365fbe9fe400580d094b44626632fcfa25` |

### 鉴权矩阵（基于现有调用面盘点）

> 设计原则：**对 Web SPA 之外的现有调用面零破坏**。Access 仅做"如果有 CF JWT 就用"，
> 不存在 JWT 也不能直接 401，必须 fall through 给后续 auth 方式。

现有调用面（盘点自代码）：

| 调用方 | 端点 | 现状鉴权 | 新方案 |
|---|---|---|---|
| Web SPA | 所有 `/api/*` 业务接口 | NextAuth session cookie | CF Access JWT（自动注入） |
| macOS 客户端 | `POST /api/upload/presign`、`POST /api/recordings`、**`GET /api/folders`**、**`GET /api/tags`** | `Authorization: Bearer <device-token>` | 同（双轨保留） |
| Backy（外部 webhook） | **`HEAD /api/backy/pull`**、**`POST /api/backy/pull`** | **`X-Webhook-Key` header**（不是 Bearer） | 同（独立 webhook-key 认证） |
| 健康检查 | `GET /api/live` | 公开 | 公开 |

### 中间件流（按顺序，每一步可短路放行）

```
secureHeaders
  ↓
runtimeContext           # 构造 RuntimeContext 注入 c.set("ctx", ctx)
  ↓
publicRoutes             # 命中 PUBLIC_ROUTES → next() 直接放行
  ↓
webhookKeyAuth           # 命中 WEBHOOK_ROUTES → 校验 X-Webhook-Key；成功写 tokenUser，失败 401（不 fall through，因为这条路径不允许走 Access/Bearer）
  ↓
accessAuth               # 有 Cf-Access-Jwt-Assertion 且校验通过 → c.set("accessEmail")；失败/缺失 → 不阻断，next()
  ↓
bearerAuth               # 没拿到 accessEmail → 尝试 Authorization: Bearer device-token；成功写 tokenUser；失败/缺失 → 不阻断
  ↓
requireAuth              # 至此仍既无 accessEmail 也无 tokenUser → 401
```

### 路由分组

| 类别 | 路由 | 鉴权要求 |
|---|---|---|
| `PUBLIC_ROUTES` | `GET /api/live` | 无 |
| `WEBHOOK_ROUTES`（`X-Webhook-Key`） | `HEAD /api/backy/pull`、`POST /api/backy/pull` | webhook-key 必需；**不**接受 Access JWT 或 Bearer（隔离 webhook 攻击面） |
| Web + macOS 共享（Access **或** Bearer） | `POST /api/upload/presign`<br>`POST /api/recordings`<br>`GET /api/folders`、`GET /api/tags`<br>**所有其余 `/api/*` 业务接口** | 任一方式通过即可 |

> ⚠️ 这里相比前一版**改了两处**：
> ① `GET /api/folders` / `GET /api/tags` 必须接受 Bearer（macOS 也用），原文档遗漏；
> ② `/api/backy/pull` 不是 Bearer 而是独立的 `X-Webhook-Key`，不能塞进 bearerAuth 流程；走单独 `webhookKeyAuth` middleware。
>
> Wave C 实施前必须 grep 一遍 `apps/macos/Lyre/Network/APIClient.swift` 全量端点，
> 把所有出现 `addAuth(&request)` 的 path 全部加入"Web + macOS 共享"路由组；不允许靠
> 文档列举漏端点导致客户端被 401 卡住。

### 本地与 E2E

- 本地（`isLocalhost`）：`accessAuth` 不短路，仅在请求**未带任何凭据**时 mock `accessEmail = "dev@local"`；带 Bearer 时仍走 `bearerAuth`，便于本地调试 macOS 链路
- E2E：`[env.test].vars.E2E_SKIP_AUTH = "true"`，`requireAuth` 检测到该 env 直接放行并 mock `accessEmail = "e2e@local.test"`

---

## 五、分阶段执行（5 个 Wave）

### Wave A — 重命名归档 + 工作区脚手架  ✅

1. `git mv apps/web apps/web_legacy`，`apps/web_legacy/package.json` 改 `@lyre/web-legacy`，保 `"private": true`。
2. 根 `package.json` scripts 复制一份 `legacy:` 前缀（`legacy:dev`、`legacy:test`、`legacy:test:e2e`、`legacy:build`），把现有 `dev`/`build`/`test` 暂时改成 `legacy:*` 的 alias，保持绿。
3. `apps/web_legacy/CLAUDE.md` 写一行 `FROZEN — see docs/03`。
4. 新建空目录：`apps/web/`、`apps/api/`、`packages/api/`，各放 `package.json` + `tsconfig.json` 骨架。`bun install` 通过。
5. 根 CLAUDE.md 增加迁移期说明指针。
6. Husky pre-commit/pre-push 暂时只跑 legacy 路径，保证不阻塞。

**验收**：根 `bun install` 成功；`bun run legacy:test` + `bun run legacy:test:e2e` 全绿；`apps/web_legacy/database/lyre.db` 路径仍工作。

### Wave B — 抽离 `@lyre/api` 包  ✅ 2026-04-26

> 完全照抄 backy Wave 1 + Wave 2 的方法论。在 lyre 上对应的动作：

#### B.0 — D1 兼容性 spike（**前置 gate，先于 B.1**）  ✅ 2026-04-26

> 把 D1 dialect 切换从"风险说明"提升为 Wave B 的**显式前置验收**。任何 spike
> 没过的项必须在文档里固化解法，否则不允许进入 B.1 大规模搬迁。

抽样验证以下高风险代码路径在 D1 dialect 下能跑通：

| 验证项 | 现位置 / 触发面 | 验收标准 |
|---|---|---|
| **多语句事务 + rollback** | `services/backup.ts` 的 import 路径多张表批量写入；`db.transaction(...)` 散见 repos | 跑通同等语义的 D1 事务（D1 单连接 batch / `.batch()` API），失败时全 rollback |
| **`.returning()`** | `recordings`、`jobs`、`device-tokens` repo INSERT 后取整行 | D1 `drizzle-orm/d1` 支持；若发现不支持，**fallback 是"按调用方已知的 TEXT id 再 SELECT 一次"**（schema 全表主键是应用层生成的 nanoid TEXT，不是自增整数，因此 `last_insert_rowid()` 不适用） |
| **复合查询（join + where + order + limit）** | `recordings-repo`、`search` | 跑通 SQL，比对结果与 better-sqlite3 一致 |
| **DateTime / 时间戳** | schema 中 `integer({mode:"timestamp"})` 等 | D1 默认 SQLite，行为一致；spike 写一条 case 验证 |
| **Drizzle migration 文件兼容** | 现 `drizzle-kit` 生成的 `.sql`（如有） | 在 wrangler `d1 execute --file` 下可直接 apply |

操作步骤：
1. 在 `packages/api/scripts/d1-spike/` 起一个独立 mini-app（不进 monorepo 主流程）
2. 复制 `db/schema.ts` 全量 + 上述高风险路径的 1-2 个真实查询
3. 用 wrangler 本地 D1（miniflare）跑通；记录每条不兼容点 + 解法到本节末尾的 spike-findings 表
4. spike-findings 全部有解法 → 进入 B.1
5. 任一项无法解决 → 回到决策点 1，可能需要切 B（Postgres）或 C（保留 Railway SQLite）

**spike-findings 表（实施时回填）**：

实施位置：`packages/api/scripts/d1-spike/spike.test.ts`（10 个用例全绿，2026-04-26）。

| # | 问题 | 现实现 | D1 行为 | 解法 |
|---|---|---|---|---|
| 1 | `.returning()` on INSERT/UPDATE | repos/*：直接 `.insert(...).returning().get()` | ✅ drizzle-orm/d1 原生支持，行为同 better-sqlite3（含 `.returning({ id, name })` 子集）；spike 中 3 个 case 全绿 | **无需 fallback**。沿用现有 `.returning()` 调用 |
| 2 | `db.transaction(callback)` 多语句事务 | repos/recordings.ts (×2)、repos/tags.ts、services/backup.ts | ❌ **D1 拒绝 BEGIN**，错误 `Failed query: begin` —— D1 HTTP 绑定无 interactive transaction 原语 | **改写为 `db.batch([stmt1, stmt2, ...])`**：原子性由 D1 内部保证，任一 statement 失败整批 rollback。但 batch 不允许"读中间结果再分支"——好在 lyre 4 处用法都是"无条件 delete + insert"或"循环 delete"，全部可声明式重写。**B.2 实施时**逐个改写：<br>• `recordings.deleteCascade` → batch([del transcriptions, del jobs, del tags, del recordings])<br>• `recordings.deleteBatch` → 外层 for-loop 收集 statement 数组再一次 batch<br>• `tags.setTagsForRecording` → batch([del recordingTags, ...inserts])<br>• `services/backup.ts.import` → 把整个 import 流程拆成"先收集 statements，再 batch"，对存在性判断改为 INSERT OR REPLACE / UPDATE WHERE 二选一（spike 已验证非 mixed 状态）|
| 3 | join + where + order + limit | repos/recordings.ts、search route | ✅ 标准 drizzle builder dialect 透明；spike 跑通 leftJoin + where + orderBy + limit，结果与 better-sqlite3 一致 | 无需调整 |
| 4 | `integer({mode:"timestamp"})` / `integer` ms 时间戳 | schema 全表 `created_at` / `recorded_at` 等 | ✅ D1 = SQLite，integer 列存读 `1_700_000_000_123` 完全一致 | 无需调整 |
| 5 | drizzle-kit generate 出的 init SQL apply | `packages/api/scripts/d1-spike/migrations/0000_grey_silver_surfer.sql` | ✅ Miniflare D1 `db.exec()` 按 `--> statement-breakpoint` 切分后逐条执行通过 | Wave E 数据迁移用相同切分方式 + `wrangler d1 execute --file=` |
| 6 | FK 约束默认状态 | spike 中 batch rollback 测试观察到 `[0, 2]` 两种合法终态 | D1 默认 `PRAGMA foreign_keys` 关闭，FK 不会阻断写入 | Wave E 初始化时显式 `PRAGMA foreign_keys=ON`（在 init.sql 头部），保持与 better-sqlite3 一致行为；B.2 实施前在文档化处补 `--> statement-breakpoint`-aware 的初始化脚本 |

**Gate 状态**：✅ 全部有解法 → 进入 B.1。

#### B.1 — Contracts 抽离（client-safe types 先行，仅前置 1 个文件即可解锁 UI）  ✅ 2026-04-26

把所有 UI 直接 import 的 server-side 模块拆成 contracts 层：

1. 新建 `packages/api/src/contracts/` 目录与 `package.json` `./contracts/*` exports（见决策点 7）
2. 第一批必须先做的 contracts（被 UI 直接消费的）：
   - `contracts/ai.ts` — provider id/displayName/model 列表/zod schema（从 `services/ai.ts` 抽）
   - `contracts/recordings.ts` — `Recording`、`TranscriptionSentence` 等纯类型（从 `lib/types.ts` 抽）
   - `contracts/jobs.ts` — `JobStatus` enum、`JobEvent` 类型
3. UI 端 `apps/web_legacy/src/components/ai-settings.tsx` 等改为 import `@lyre/api/contracts/ai`
4. ESLint `no-restricted-imports` 规则加到 web_legacy，禁止从 `@lyre/api`（顶层）/ `@lyre/api/services/*` / `@lyre/api/handlers/*` 导入到 components/pages

#### B.2 — 物理迁移 lib/services/db 到 packages/api（保持行为不变）  ✅ 2026-04-26

`git mv` 以下文件到 `packages/api/src/lib/`：
- `db/{schema,index}.ts` + `db/repositories/*`
- `services/{ai,asr,asr-provider,backup,backy,oss}.ts`
- `services/{job-manager,job-manager-singleton,job-event-hub,job-processor}.ts` —— **保留运行**（决策点 8）；legacy `apps/web_legacy` 仍 import 这几个并继续在 next 进程内常驻；新 worker 不挂这些
- `lib/{api-auth,types,utils,palette,sidebar-nav}.ts` 中的纯逻辑部分（UI 工具如 `cn`、`badge-colors`、`category-icons` 留 web_legacy）

`apps/web_legacy` 加 `@lyre/api: workspace:*` 依赖，所有 `@/lib/*` `@/services/*` `@/db/*` 全替换为 `@lyre/api/*` subpath imports（**严格按 contracts vs services 分层**：UI 仅 contracts，route handlers 用 services + handlers）。

**关键替换 — DB dialect**（B.0 spike 通过后实施）：
- 新建 `packages/api/src/lib/db/d1-binding.ts`（Worker binding 实现给 apps/api 用，Drizzle `drizzle-orm/d1`）
- legacy 持久化策略：**Wave B 期间 legacy 继续用 better-sqlite3** —— 把 dialect 切换隔离在 worker binding 一侧，避免 legacy 一夜变天。`packages/api/src/lib/db/index.ts` 导出根据 `RuntimeContext.db` 注入而非全局单例
- legacy route adapter 内构造 `RuntimeContext`：dev/legacy `db = drizzleSqlite(better-sqlite3)`；worker `db = drizzleD1(c.env.DB)`
- Wave E 数据迁移完成后，legacy 即将下线，无需把 better-sqlite3 一并切到 D1

> ⚠️ 这是整个迁移最大的工作量。但因为 legacy 不切 dialect，复杂度集中在 worker 一侧 + spike 验证 query 兼容性。

#### B.3 — 抽 handlers 出来（去 Next 依赖）  ✅ 2026-04-26

照 backy `HandlerResponse` 协议（`json | bytes | empty | text` 四分支；**SSE 不需要新增 stream 分支**，因为决策 3 + 决策 8 — 新 worker 不实现 SSE 端点）。

每个 `apps/web_legacy/src/app/api/**/route.ts` 的业务逻辑提到 `packages/api/src/handlers/`，route 文件退化为 4-10 行 adapter（构造 `RuntimeContext` → 调 handler → `toResponse`）。

例外：`apps/web_legacy/src/app/api/jobs/events/route.ts`（SSE）**不抽 handler**，整体保留在 legacy 里直到 Wave E 整目录删除（决策点 8）。

可能的 handler 分组（共 32 个 route.ts → 估计 40+ 方法 handler）：
- `recordings.ts` — list / create / get / update / delete / batch / play-url / download-url / words / transcribe / summarize
- `folders.ts` / `tags.ts` — CRUD ×2 套
- `search.ts` / `dashboard.ts` — query
- `upload.ts` — presign
- `jobs.ts` — get **only**（无 events，决策 8）
- `settings.ts` — ai / oss / backup / backy / tokens / pull-key / test / history（嵌套子树）
- `backy.ts` — pull
- `live.ts`

**RuntimeContext** 抽象（参考 backy Wave B）：
```ts
export interface RuntimeContext {
  db: DbAdapter;          // Drizzle 实例：worker = drizzle(c.env.DB) 走 D1 binding；legacy = drizzle(better-sqlite3)
  oss: OssAdapter;        // V1 签名 + presign
  asr: AsrProvider;       // dashscope / mock 工厂
  ai: AiProvider;
  env: LyreEnv;           // 强类型 env（DASHSCOPE_API_KEY、AI_*、OSS_*、BACKY_*、CF_ACCESS_*…）
  info: RuntimeInfo;      // uptime/memory，Worker 退化为 null
  clock: Clock;           // Date.now()，可注入
  user: AuthUser | null;  // accessEmail or device-token user
}
```

**强约束**：handler 顶层不再读 `process.*`、不再 import 具体 SDK 客户端、不再
import `next/*`。
- `grep -r "process\." packages/api/src | grep -v __tests__` ≈ 空
- `grep -r "from \"next" packages/api/src` 空

#### B.4 — Coverage / 双 workspace 门禁  ✅ 2026-04-26

照 backy Wave 1 「Coverage gate plumbing」：
- `packages/api/scripts/check-coverage.ts`（90% 阈值，复制 web_legacy 那份）
- `packages/api/eslint.config.mjs`（tseslint strict，无 Next/React）
- 根 `package.json` fan-out `lint` / `typecheck` / `test` / `test:coverage` 到三个 workspace（web_legacy + api + packages/api）

#### B.5 — JobManager 收尾（**不删**，仅准备 cron handler）  ✅ 2026-04-26

按决策点 8 锁定的"保留 legacy SSE，新 worker 不挂"策略：
- ❌ **不**删除 `services/job-manager*.ts`、`services/job-event-hub.ts`、`hooks/use-job-events.ts`、`/api/jobs/events/route.ts` —— legacy `apps/web_legacy` 期间继续依赖这些跑 SSE
- ✅ 新建 `packages/api/src/handlers/jobs.ts` 中的 `cronTickHandler`（批量扫 RUNNING → 调 `pollJob` → 写 DB），**仅给新 worker 的 `scheduled()` 用**；legacy 不调
- ✅ legacy 期间形成两套并存：legacy 进程内 JobManager 单例 + worker Cron（指向同一份数据 → Wave E 切流前 worker 用 test D1，不会双写 prod 数据）
- ✅ Wave E 数据迁移 + DNS 切换后，legacy 自然下线，SSE 代码随 `apps/web_legacy/` 整目录删除

#### B.6 — DB 注入到 RuntimeContext（Wave C 前置）

**B.6.a 基础设施 ✅ 2026-04-26**：
- ✅ `packages/api/src/db/types.ts` 新增 `LyreDb` 类型别名
- ✅ `packages/api/src/db/drivers/sqlite.ts` 抽出 Bun/better-sqlite3 driver（唯一 import `fs`/`bun:sqlite`/`better-sqlite3` 的位置）
- ✅ `packages/api/src/db/drivers/d1.ts` 占位 D1 driver + `D1DatabaseLike` 接口
- ✅ `packages/api/src/db/index.ts` 改为 thin wrapper（保留 `db` Proxy + `resetDb` 单例 API 给 legacy）
- ✅ `RuntimeContext` 新增可选 `db: LyreDb` 字段
- ✅ legacy `handler-adapter.ts` 在 `buildContext()` 注入 SQLite singleton 至 `ctx.db`
- ✅ 测试 fixture `_fixtures/runtime-context.ts` 同样注入 `db`

**B.6.b 渐进迁移 ⬜ Wave C 前必须完成**：
- ✅ Repo 工厂化：`makeUsersRepo(db)`、`makeRecordingsRepo(db)` 等 8 个 + `makeRepos(db)` 聚合；保留旧 `usersRepo` 别名 = `makeUsersRepo(globalDb)`（2026-04-26）
- ✅ Handler 层切 `ctx.db`：`packages/api/src/handlers/*` 全部 11 个文件；`api-auth.ts` 也改造为接收 `db: LyreDb`，legacy adapter 注入（2026-04-26）
- ✅ Service 层接 `db?: LyreDb`：`job-processor.ts`（`pollJob`、`autoSummarize`）、`backy.ts`（`readBackySettings`/`readPullKey`/`savePullKey`/`deletePullKey`/`findUserIdByPullKey`）、`backup.ts`（`exportBackup`/`importBackup`/`pushBackupToBacky`）；optional 参数兼容 legacy 单例与测试（2026-04-26）
- ✅ D1 repo 实测：`packages/api/scripts/d1-spike/repo-async.test.ts`，对 8 个 repo 共 40 个方法逐一探测 D1 dialect 行为，结论 **40/40 全部需要 async 化重写**（2026-04-26）
- ⬜ Worker 入口（Wave C）用 `openD1Db(env.DB)` 注入；进入前**必须**先执行 Wave C.0 repo async 化（见下）
- ⬜ legacy 单例下线（Wave E）

**B.6.b.4 spike-findings 表**（实施位置：`packages/api/scripts/d1-spike/repo-async.test.ts`，10 个用例全绿）

| 行为类 | 数量 | 表现 | Wave C 处置 |
|---|---|---|---|
| `promise` | 33 | `.get()` / `.all()` / `.returning().get()` 链返回 Promise，sync 调用方拿不到值 | 方法签名改 `async`，链尾加 `await` |
| `silent-wrong` | 5 | `.run() as { changes: number }` → `.changes` 在 Promise 上是 `undefined`，`undefined > 0 === false`，**沉默地永远报告 "什么都没删除"**；命中 `users.delete`/`folders.delete`/`recordings.delete`/`settings.delete`/`deviceTokens.deleteByIdAndUser`/`transcriptions.deleteByRecordingId` | 方法改 async，`const result = await ...; return result.meta.changes > 0`（D1 `.run()` 返回结构是 `{ success, meta: { changes } }`，与 better-sqlite3 不同） |
| `throw` | 2 | `.all().map(...)`/`.then(rows => ...)` 链：因为 `.all()` 是 Promise，立刻在它上面调 `.map` 抛 `is not a function`；命中 `tags.findTagIdsForRecording`/`tags.findTagsForRecording` | 同上 async 化；`.run() as { changes: number }` 同样需要适配 D1 返回结构 |

#### Wave B 验收（全部完成）：
- B.0 spike-findings 全部有解法
- 三个 workspace `typecheck`/`lint`/`test:coverage` 全绿，覆盖率 ≥ 90%
- `bun run legacy:test:e2e` 全绿（legacy 已切到 `@lyre/api`，行为不变；SSE 仍工作）
- 无 `process.*` / `next/*` / `@/services/*` 残留在 packages/api
- ESLint `no-restricted-imports` 阻止 UI 端 import `@lyre/api/services/*` 或 `@lyre/api/handlers/*`

### Wave C — `apps/api` Worker 装配  ⬜

#### Wave C.0 — Repo / service 层 async 化（前置 gate）  ✅

来自 B.6.b.4 实测：当前 8 个 repo 共 40 个方法在 D1 dialect 下全部不能跑（细节见上方 spike-findings 表）。Wave C 装配 worker 前，先把 repo + 受影响的 service / handler 改 async：

1. **8 个 repo 全部 async 化**：每个方法改 `async`，链尾 `await`，写入方法读 `result.meta.changes`（D1）—— 但 better-sqlite3 没 `meta` 字段；解法是引入 `LyreDb` 上的统一 `runResult` helper，由 driver 适配（sqlite driver 走 `result.changes`，d1 driver 走 `result.meta.changes`），repo 调 `helper.changes(result)`。
2. **handlers**（11 个文件）→ 所有 `repos.xxx.findById(...)` 等 41 个 sync 调用点加 `await`，handler 函数已经是 async 没问题。
3. **services**（`backup.ts`、`backy.ts`、`job-processor.ts`、`job-manager.ts`）→ 同步调用 repo 的地方加 `await`；`backup.importBackup` 的 `db.transaction` 改 `db.batch([...])`（B.0 spike finding #2）。
4. **legacy adapter** 不受影响：legacy 仍跑 better-sqlite3，sync API 在 await 下表现为立即 resolve 的 Promise，行为不变。
5. 跑 `bun run api:test` + `bun run legacy:test` + `bun run legacy:test:e2e` 全绿。

**验收**：
- `bun test packages/api/scripts/d1-spike/repo-async.test.ts` 重新跑：把"全部 broken"断言反过来，证明 await 后全部 OK ✅（40/40 promise）
- legacy 行为零回归 ✅（packages/api 127 tests pass）

#### Wave C.1 — Worker 装配  ⬜

1. `apps/api/wrangler.toml`：`compatibility_flags = ["nodejs_compat"]`、`[[d1_databases]] binding = "DB"`、`[[r2_buckets]]` 不需要（OSS 是阿里云，HTTP fetch）、`[triggers] crons = ["* * * * *"]`、`[assets] directory = "./static" run_worker_first = ["/api/*"] not_found_handling = "single-page-application"`、`[env.test]` 设 `E2E_SKIP_AUTH = "true"` 与 test D1 binding。
2. Hono app（`apps/api/src/index.ts`）：装 `secureHeaders` + `runtimeContext` + `accessAuth` + `bearerAuth`，挂所有 routes。
3. `routes/*.ts`：每个文件 `app.get/post/...` 调对应 `@lyre/api/handlers/*` 函数 + `toResponse(c, result)`。
4. `middleware/access-auth.ts`：照搬 surety 实现，AUD/team 改 lyre 自有。
5. `middleware/bearer-auth.ts`：照 surety `apiKeyAuth`，对接 `device-tokens` repo（`packages/api/src/lib/db/repositories/device-tokens.ts`）。
6. `scheduled()` export：调 `cronTickHandler({ ctx })` 处理 ASR 轮询。
7. `routes/me.ts`：返回 `{ email, name, avatarUrl }`（决策点 6 锁定的 shape）。来源：email/name 优先取 CF Access JWT payload（`c.get("accessEmail")` + middleware 缓存的 `name`），device-token 路径下用 `tokenUser.userId` 查 users 表；avatarUrl 始终查 users 表 `avatarUrl` 列（SQL `avatar_url`），无则 `null`。
8. 单测：每条路由 ≥ 1 happy + 1 401（mock RuntimeContext）。
9. 本地：`bun --cwd apps/api dev`（`wrangler dev --port 7017 --local`）；`apps/web_legacy` 仍跑 7016 不冲突。

**验收**：
- `wrangler dev` 起得来，`curl http://localhost:7017/api/live` 200
- 带 `E2E_SKIP_AUTH=true` 跑一份"指向 worker"的 L2 e2e（迁移现 e2e suite）全绿
- `grep -r "next/server\|NextResponse" apps/api/src` 空

### Wave D — `apps/web` Vite SPA 重写  ⬜

1. 套用 surety/backy 已验证脚手架：`vite.config.ts` + `@tailwindcss/vite` + `react@19` + `react-router@7` + `swr` + `sonner` + `next-themes` 替换为 `<ThemeProvider>` 自实现（surety 已有参考）。
2. 路由表对齐现 Next.js App Router：
   - `/` → Dashboard
   - `/login` 删除（Access 接管 SSO）
   - `/recordings`、`/recordings/:id`
   - `/settings`、`/settings/ai`、`/settings/storage`、`/settings/tokens`
3. 数据层：`src/lib/api.ts` 用 `fetch`（`credentials: "include"`），SWR key 即 URL；`apiFetch`/`apiJson` 统一抛 `ApiError`；401 → 触发 `window.location.reload()`（让 Access 拦回 SSO）。
4. 组件平移：`components/{layout,ui}` + 业务组件（`audio-player`、`cassette-player`、`transcript-viewer`、`recording-card/list-item/tile-card`、`global-search`、`upload-dialog`、`device-tokens`、`ai-settings`、`oss-storage`、`recording-detail-vm` 等）从 `web_legacy` `cp -R`，按 React 19 / router 7 调整：
   - 去 `"use client"`
   - `next/link` → `react-router` 的 `<Link>`
   - `next/image` → `<img>`（OSS 直链）
   - `next/navigation` 的 `useRouter`/`usePathname` → `useNavigate`/`useLocation`
   - `useSearchParams` → react-router 的 `useSearchParams`（无需 Suspense 包裹）
5. 主题 FOUC 预防脚本迁到 `index.html` `<head>` 内联。
6. 构建：`vite build --outDir ../api/static`，worker `[assets]` 直接托管。
7. **Auth 替换专项**（NextAuth 渗透点逐一处理）：
   - 删除 `auth.ts`（NextAuth 配置）、`proxy.ts`（鉴权重定向）、`auth-provider.tsx`、`login/page.tsx`
   - sidebar 用户信息：`useMe()` SWR hook 拉 `/api/me`，shape `{ email, name, avatarUrl }`（决策点 6）；sidebar 字段映射 `session.user.name → me.name`、`session.user.image → me.avatarUrl`；首字母兜底逻辑（`userName[0]`）保留
   - 登出按钮：`<a href="https://nocoo.cloudflareaccess.com/cdn-cgi/access/logout">`
   - 顶层包 `<RequireAuth>`：未拿到 email → "Redirecting…" + `location.reload()`
   - **不要在前端做 token 校验** —— Access 在 worker 边缘已经挡住未授权请求
   - device-token 管理 UI（`/settings/tokens`）保留：CRUD device tokens 仍走 `/api/settings/tokens/*`，Access 已认证用户可管理自己的 token
8. `apps/web/package.json` 仅依赖 vite/react/react-router/swr/tailwind/recharts/sonner/lucide/cmdk/radix-ui/react-markdown/remark-gfm/clsx/tw-merge；**不**依赖 next、next-auth、better-sqlite3、drizzle-orm、ai、@ai-sdk/*、@nocoo/next-ai —— 这些都被 `@lyre/api` 吃掉。
9. `next-themes` 的替代：要么自写 ThemeContext + localStorage（参考 surety），要么 fork 一个无 next 依赖的 fork；**评估后决定**。

**验收**：
- `bun --cwd apps/web dev` + `bun --cwd apps/api dev` 联调，所有页面渲染、CRUD 跑通
- L3 Playwright 全绿（runner 改起 vite + wrangler 双进程）
- 无 console error / 404；FOUC 不闪
- `grep -rn "next" apps/web/src` 空（除注释）

### Wave E — 部署 + 收尾  ⬜

1. CF Zero Trust 控制台建 lyre 的 Access application，记录 AUD 写入 `wrangler.toml`。
2. `wrangler d1 create lyre-db` + `wrangler d1 create lyre-db-test`，分别在 prod / test env 绑定。
3. Schema 初始化：`wrangler d1 execute lyre-db --file=packages/api/migrations/0000_init.sql`（drizzle generate）。
4. **数据迁移**：从 Railway 上的 `lyre.db` 导出 → 转换为 D1 SQL → `wrangler d1 execute --file`。需要写一次性脚本 `scripts/migrate-sqlite-to-d1.ts`。验证关键表（recordings、transcriptions、device-tokens）行数一致 + 抽样校验。
5. `wrangler secret put DASHSCOPE_API_KEY` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `AI_*` / `BACKY_*` 等所有 secret。
6. `wrangler deploy --env=test` → 验 staging（curl + Playwright 指向 test 域名）。
7. `wrangler deploy` → prod；DNS 切到 worker custom domain（macOS 客户端 server URL 不变即生效）。
8. 根 `package.json` scripts 全切到新栈：`dev`/`build`/`test`/`test:coverage`/`test:e2e` 指向 `apps/web` + `apps/api` + `packages/api`；保 `legacy:*` 一段时间。
9. CI / Husky 切到新链路。
10. **观察期 7 天**后删除：
    - `apps/web_legacy/`（含 Dockerfile、railway.json）
    - 根 `legacy:*` 脚本
    - Railway 服务（保留 DB 备份导出文件）

**验收**：
- 生产域名走 Access，未登录跳 nocoo team SSO
- 登录后所有功能与 web_legacy 一致
- macOS 客户端调 worker 域名上传录音正常
- backy pull、ASR 转写、AI 总结、device token 管理、folder/tag CRUD、search、dashboard 全部回归通过
- Cron Trigger 1 分钟周期跑 ASR 轮询，详情页 SWR 刷新看到状态推进
- `gate:security` 清单更新（next/next-auth/better-sqlite3 仅 web_legacy 残留 → 删除目录后清零）

---

## 六、已知风险 / 注意事项

| 风险 | 缓解 |
|---|---|
| **DB dialect 切换工作量被低估** | Wave B.0 spike 强制前置；legacy 期间**继续用 better-sqlite3 不切 dialect**，D1 dialect 仅在新 worker 一侧实施（无需写"REST D1Adapter 给 legacy 用"）；query 兼容性差异在 spike-findings 表逐条记录解法，进入 B.2 前必须清零 |
| **数据迁移风险** | Wave E 之前先做一次 dry-run（test D1）；保留 Railway DB 至少 30 天 |
| **`@nocoo/next-ai` 替换** | 评估后选 ① fork 砍 next 依赖 ② 直接用 `ai` SDK 重写 —— 决策放在 Wave B 开始时 |
| **`next-themes` 替换** | 自写 ThemeContext（< 50 行），surety/bat 已有参考 |
| **JobManager 删除带来的体验降级** | Cron 1 分钟分辨率对 ASR 任务可接受；前端打开详情页时 SWR `refreshInterval: 5s` 顶替；用户离开页面后状态不实时但下次打开会拉到最新 |
| **macOS 客户端 server URL 切换** | 文档化迁移指南，包含旧 token 在新域名继续可用的验证步骤 |
| **OSS 签名在 Web Crypto 下的实现** | Wave B 单独写一个测试 case 跑 `crypto.subtle.sign('HMAC', ...)`，与 Node `crypto.createHmac` 输出对比 |
| **Worker CPU/内存上限** | lyre 没有 backy 那种"FormData buffer 大文件"路径（OSS 直传），主要风险是 ASR result JSON（可能几 MB） + AI summarize streaming —— 都是流式，无内存问题 |
| **better-sqlite3 在 web_legacy 还要继续跑** | 通过 dialect 抽象层让 legacy 保留 better-sqlite3 dialect，新 worker 用 D1 dialect；schema 单一来源（packages/api） |

---

## 七、Open Questions（已确认 — 2026-04-26）

1. ✅ 决策 1（持久化）→ **D1**（`lyre-db` / `lyre-db-test` 已建）
2. ✅ 决策 2（JobManager）→ **A+C 混合**（Cron + 前端 SWR）
3. ✅ 决策 3（SSE）→ **删除**
4. ✅ Access AUD → **lyre 单独 application**（`0f089ac6...fcfa25`）
5. Worker 自定义域名 — 倾向 `lyre.hexly.ai`，最终 Wave E 前再确认
6. 数据迁移窗口 — **冷迁移**（5-10 分钟停机，个人工具可控）
7. macOS 客户端 server URL — 现已支持显式配置，Wave E 前发文档说明即可，**无需客户端发版**

---

## 八、参考文件清单（实施时直接对照）

| 用途 | 文件 |
|---|---|
| Wave 划分 + HandlerResponse 协议 | `../backy/docs/06-api-extraction-plan.md` |
| Vite + Worker + Access 端到端 | `../backy/docs/07-vite-web-migration-plan.md` |
| `accessAuth` middleware 实现 | `../surety/apps/worker/src/middleware/access-auth.ts` |
| `apiKeyAuth`（→ bearerAuth）模板 | `../surety/apps/worker/src/middleware/api-key-auth.ts` |
| Hono app 装配 | `../surety/apps/worker/src/index.ts` |
| Vite SPA 主题/路由/api 客户端 | `../surety/apps/web/src/{api.ts,App.tsx,main.tsx}` |
| Bun monorepo workspace 范式 | `../bat`、`../backy`（均已落地） |
